import { sha256Hex } from "../shared/crypto";

export interface MemoryScope {
  project: string;
  namespace: string;
}

export interface ActorContext {
  ownerId: string;
  actorId: string;
  authKind: "access" | "root";
}

export async function opaqueId(prefix: string, ...parts: string[]): Promise<string> {
  return `${prefix}_${(await sha256Hex(parts.join("\u0000"))).slice(0, 32)}`;
}

export function projectOpaqueId(ownerId: string, project: string): Promise<string> {
  return opaqueId("prj", ownerId, project);
}

export function memoryOpaqueId(projectId: string, namespace: string, key: string): Promise<string> {
  return opaqueId("mem", projectId, namespace, key);
}

export async function vectorScopeId(ownerId: string, project: string, namespace: string, indexVersion: string): Promise<string> {
  return `scope_${(await sha256Hex([ownerId, project, namespace, indexVersion].join("\u0000"))).slice(0, 40)}`;
}
