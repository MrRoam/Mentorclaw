import type { ProjectState, ResourceRef } from "../schemas/models.ts";

export interface SourceRegistry {
  registerSource(sourceType: string, capabilities: string[]): void;
  listSources(): Array<{ sourceType: string; capabilities: string[] }>;
}

export interface IngestionProvider {
  readonly sourceType: string;
  ingest(input: { uri: string; title?: string }): Promise<ResourceRef>;
}

export interface ResourceNormalizer {
  normalize(resource: ResourceRef): ResourceRef;
}

export interface QualityScorer {
  score(resource: ResourceRef): number;
}

export interface RightsPolicy {
  resolve(resource: ResourceRef): ResourceRef["rights"];
}

export interface ResourceBinder {
  bindToProject(project: ProjectState, resources: ResourceRef[]): ProjectState;
}

export class InMemorySourceRegistry implements SourceRegistry {
  private readonly sources = new Map<string, string[]>();

  registerSource(sourceType: string, capabilities: string[]): void {
    this.sources.set(sourceType, capabilities);
  }

  listSources(): Array<{ sourceType: string; capabilities: string[] }> {
    return Array.from(this.sources.entries()).map(([sourceType, capabilities]) => ({ sourceType, capabilities }));
  }
}

export class PassThroughNormalizer implements ResourceNormalizer {
  normalize(resource: ResourceRef): ResourceRef {
    return { ...resource, title: resource.title.trim() };
  }
}

export class DefaultQualityScorer implements QualityScorer {
  score(resource: ResourceRef): number {
    return Number((resource.trustScore * 0.7 + resource.relevanceScore * 0.3).toFixed(2));
  }
}

export class ConservativeRightsPolicy implements RightsPolicy {
  resolve(resource: ResourceRef): ResourceRef["rights"] {
    if (resource.sourceType === "user_upload") return "cache_allowed";
    if (resource.kind === "web") return "link_only";
    return resource.rights;
  }
}

export class ProjectResourceBinder implements ResourceBinder {
  bindToProject(project: ProjectState, resources: ResourceRef[]): ProjectState {
    const merged = new Map(project.resources.notes.map((note, index) => [`note-${index}`, note]));
    for (const resource of resources) {
      merged.set(resource.id, resource.title.trim());
    }
    project.resources.notes = Array.from(merged.values());
    return project;
  }

  bindToPlan(project: ProjectState, resources: ResourceRef[]): ProjectState {
    return this.bindToProject(project, resources);
  }
}

// Legacy alias kept during the project-centric transition.
export const PlanResourceBinder = ProjectResourceBinder;

export class StubIngestionProvider implements IngestionProvider {
  readonly sourceType = "stub";

  async ingest(input: { uri: string; title?: string }): Promise<ResourceRef> {
    return {
      id: `resource-${Math.abs(input.uri.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0))}`,
      title: input.title ?? input.uri,
      kind: "web",
      sourceType: this.sourceType,
      uri: input.uri,
      binding: "project",
      trustScore: 0.5,
      relevanceScore: 0.5,
      rights: "link_only",
    };
  }
}
