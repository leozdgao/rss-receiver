import fs from "node:fs";
import path from "node:path";

export type SummarySkill = {
  id: string;
  version: number;
  name: string;
  description: string;
  instructions: string;
};

export class SummarySkillRegistry {
  private skills: Map<string, SummarySkill>;

  private constructor(skills: SummarySkill[]) {
    this.skills = new Map(skills.map((skill) => [skill.id, skill]));
    if (!this.skills.has("default")) {
      throw new Error("Summary skill registry must include a default skill.");
    }
  }

  static load(skillsDir: string): SummarySkillRegistry {
    const files = fs
      .readdirSync(skillsDir)
      .filter((file) => file.endsWith(".json"))
      .sort();
    const skills = files.map((file) => {
      const raw = fs.readFileSync(path.join(skillsDir, file), "utf8");
      return validateSkill(JSON.parse(raw), file);
    });
    return new SummarySkillRegistry(skills);
  }

  get(skillId: string | undefined): SummarySkill {
    if (!skillId) return this.defaultSkill();
    return this.skills.get(skillId) ?? this.defaultSkill();
  }

  defaultSkill(): SummarySkill {
    return this.skills.get("default") as SummarySkill;
  }

  list(): SummarySkill[] {
    return [...this.skills.values()];
  }

  maxVersion(): number {
    return Math.max(...this.list().map((skill) => skill.version));
  }
}

function validateSkill(value: unknown, file: string): SummarySkill {
  const skill = value as Partial<SummarySkill>;
  if (
    !skill.id ||
    typeof skill.version !== "number" ||
    !skill.name ||
    !skill.description ||
    !skill.instructions
  ) {
    throw new Error(`Invalid summary skill file: ${file}`);
  }
  return {
    id: skill.id,
    version: skill.version,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions
  };
}
