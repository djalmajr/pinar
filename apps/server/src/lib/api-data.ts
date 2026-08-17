import {
  type Collection,
  type Pin,
  type Project,
  type ProjectTreeCollection,
  type ProjectTreeProject,
  type Session,
} from "@pinar/shared";
import { isProjectIcon } from "@pinar/shared/project-icons";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readResponseRecord(response: Response): Promise<Record<string, unknown> | null> {
  const body = await response.text();
  if (!body) return null;
  try {
    const value: unknown = JSON.parse(body);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isPoint(value: unknown) {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

export function isPin(value: unknown): value is Pin {
  return isRecord(value)
    && typeof value.comment === "string"
    && isPoint(value.coords)
    && typeof value.number === "number"
    && (value.type === "point" || value.type === "area");
}

export function isSession(value: unknown): value is Session {
  return isRecord(value)
    && typeof value.createdAt === "string"
    && typeof value.id === "string"
    && isRecord(value.page)
    && typeof value.page.title === "string"
    && typeof value.page.url === "string"
    && Array.isArray(value.pins)
    && value.pins.every(isPin);
}

function hasContainerFields(value: unknown) {
  return isRecord(value)
    && typeof value.createdAt === "string"
    && typeof value.id === "string"
    && typeof value.isProtected === "boolean"
    && typeof value.name === "string"
    && typeof value.ownerId === "string"
    && typeof value.position === "number"
    && typeof value.updatedAt === "string";
}

function isProject(value: unknown): value is Project {
  return isRecord(value) && hasContainerFields(value) && isProjectIcon(value.icon);
}

function isCollection(value: unknown): value is Collection {
  return isRecord(value)
    && hasContainerFields(value)
    && (value.parentId === null || typeof value.parentId === "string")
    && typeof value.projectId === "string";
}

export function isProjectTreeCollection(value: unknown): value is ProjectTreeCollection {
  return isRecord(value)
    && isCollection(value)
    && Array.isArray(value.sessions)
    && value.sessions.every(isSession);
}

export function isProjectTreeProject(value: unknown): value is ProjectTreeProject {
  return isRecord(value)
    && isProject(value)
    && Array.isArray(value.collections)
    && value.collections.every(isProjectTreeCollection);
}
