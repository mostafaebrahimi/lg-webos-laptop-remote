import type { DriverDescriptor, DriverFactory } from "./types";
import { WEBOS_DESCRIPTOR, WebOsDriver } from "./webos/WebOsDriver";
import { SAMSUNG_DESCRIPTOR } from "./samsung/SamsungDriver";

interface DriverRegistration {
  descriptor: DriverDescriptor;
  /** Absent while a brand is declared but not implemented yet. */
  create?: DriverFactory;
}

/**
 * Every TV brand the application knows about. Adding one means writing a
 * `TvDriver` implementation and adding it here — no other layer changes.
 */
const REGISTRY: DriverRegistration[] = [
  { descriptor: WEBOS_DESCRIPTOR, create: () => new WebOsDriver() },
  { descriptor: SAMSUNG_DESCRIPTOR },
];

export const DEFAULT_DRIVER_ID = WEBOS_DESCRIPTOR.id;

export function listDrivers(): DriverDescriptor[] {
  return REGISTRY.map((entry) => entry.descriptor);
}

export function describeDriver(id: string): DriverDescriptor {
  const entry = REGISTRY.find((candidate) => candidate.descriptor.id === id);
  if (!entry) throw new Error(`Unknown TV type “${id}”.`);
  return entry.descriptor;
}

export function createDriver(id: string) {
  const entry = REGISTRY.find((candidate) => candidate.descriptor.id === id);
  if (!entry) throw new Error(`Unknown TV type “${id}”.`);
  if (!entry.create) {
    throw new Error(`${entry.descriptor.name} support is not implemented yet.`);
  }
  return entry.create();
}
