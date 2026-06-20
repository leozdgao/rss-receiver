import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { Page } from "playwright";
import { logError, logInfo } from "../../shared/logger.js";

const CHALLENGE_STATUSES = new Set([401, 403, 429, 503]);
const CHALLENGE_MARKERS = ["just a moment", "enable javascript", "verifying you are human"];

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

export type ExtractedArticle = {
  title?: string;
  publishedAt?: string;
  rawHtml?: string;
  readabilityHtml?: string;
  textContent?: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  status: "Success" | "Failed";
  failureReason?: string;
};

export async function fetchHtml(
  url: string,
  timeoutMs: number,
  userAgent: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "upgrade-insecure-requests": "1",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1"
      }
    });

    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status} ${response.statusText}`, response.status);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Some sources (e.g. openai.com) sit behind a Cloudflare JS challenge that
 * plain `fetch` cannot pass regardless of User-Agent. Fall back to a headless
 * browser so the challenge JS can run. Only triggered for challenge-shaped
 * statuses to avoid launching a browser for genuine errors like 404.
 */
async function resolveHtml(
  url: string,
  timeoutMs: number,
  userAgent: string,
  fallbackBrowser: boolean
): Promise<string> {
  try {
    return await fetchHtml(url, timeoutMs, userAgent);
  } catch (error) {
    if (!fallbackBrowser) throw error;
    const status = error instanceof HttpError ? error.status : undefined;
    if (status === undefined || !CHALLENGE_STATUSES.has(status)) throw error;
    logInfo("Extraction blocked by HTTP challenge; retrying with headless browser.", { url, status });
    try {
      const html = await fetchHtmlWithBrowser(url, timeoutMs, userAgent);
      logInfo("Extraction succeeded via headless browser.", { url, bytes: html.length });
      return html;
    } catch (browserError) {
      logError("Headless browser fallback failed.", browserError, { url });
      throw error;
    }
  }
}

export async function fetchHtmlWithBrowser(
  url: string,
  timeoutMs: number,
  userAgent: string
): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForChallengeToClear(page, timeoutMs);
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function waitForChallengeToClear(page: Page, timeoutMs: number): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const title = (document.title ?? "").toLowerCase();
        const body = (document.body?.innerText ?? "").toLowerCase();
        return (
          !title.includes("just a moment") &&
          !body.includes("enable javascript") &&
          !body.includes("verifying you are human")
        );
      },
      { timeout: Math.min(timeoutMs, 15_000) }
    );
  } catch {
    // Challenge already cleared or did not resolve within the budget; read whatever the page holds.
  }
}

export async function extractArticle(
  url: string,
  timeoutMs: number,
  userAgent: string,
  fallbackBrowser = true
): Promise<ExtractedArticle> {
  try {
    const rawHtml = await resolveHtml(url, timeoutMs, userAgent, fallbackBrowser);
    const dom = new JSDOM(rawHtml, { url });
    const documentTitle = dom.window.document.querySelector("title")?.textContent?.trim() || undefined;
    const publishedAt = extractPublishedAt(dom.window.document);
    const article = new Readability(dom.window.document).parse();

    if (!article?.textContent?.trim()) {
      const challengeHit = Boolean(rawHtml) &&
        CHALLENGE_MARKERS.some((marker) => rawHtml!.toLowerCase().includes(marker));
      return {
        rawHtml,
        publishedAt,
        status: "Failed",
        failureReason: challengeHit
          ? "Blocked by bot challenge (Cloudflare) even after headless browser fallback."
          : "Readability returned no text content."
      };
    }

    return {
      rawHtml,
      title: article.title?.trim() || documentTitle,
      publishedAt,
      readabilityHtml: article.content ?? undefined,
      textContent: article.textContent.trim(),
      byline: article.byline ?? undefined,
      siteName: article.siteName ?? undefined,
      excerpt: article.excerpt ?? undefined,
      status: "Success"
    };
  } catch (error) {
    return {
      status: "Failed",
      failureReason: error instanceof Error ? error.message : String(error)
    };
  }
}

export function extractPublishedAt(document: Document): string | undefined {
  const jsonLdDate = extractJsonLdPublishedAt(document);
  if (jsonLdDate) return jsonLdDate;

  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="datePublished"]',
    'meta[itemprop="datePublished"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="publish-date"]',
    'meta[name="date"]'
  ];

  for (const selector of metaSelectors) {
    const value = document.querySelector(selector)?.getAttribute("content");
    const normalized = normalizeDate(value);
    if (normalized) return normalized;
  }

  const timeValue = document.querySelector("time[datetime]")?.getAttribute("datetime");
  return normalizeDate(timeValue);
}

function extractJsonLdPublishedAt(document: Document): string | undefined {
  const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
  for (const script of scripts) {
    const text = script.textContent?.trim();
    if (!text) continue;
    for (const candidate of parseJsonLdCandidates(text)) {
      const date = findPublishedAtInJsonLd(candidate);
      if (date) return date;
    }
  }
  return undefined;
}

function parseJsonLdCandidates(text: string): unknown[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function findPublishedAtInJsonLd(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const date = findPublishedAtInJsonLd(item);
      if (date) return date;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const directDate =
    normalizeDate(record.datePublished) ??
    normalizeDate(record.dateCreated) ??
    normalizeDate(record.uploadDate);
  if (directDate && looksLikeArticle(record)) return directDate;

  const graphDate = findPublishedAtInJsonLd(record["@graph"]);
  if (graphDate) return graphDate;

  for (const child of Object.values(record)) {
    if (!child || typeof child !== "object") continue;
    const date = findPublishedAtInJsonLd(child);
    if (date) return date;
  }

  return directDate;
}

function looksLikeArticle(record: Record<string, unknown>): boolean {
  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => {
    if (typeof item !== "string") return false;
    return ["article", "blogposting", "newsarticle", "techarticle"].includes(item.toLowerCase());
  });
}

function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
