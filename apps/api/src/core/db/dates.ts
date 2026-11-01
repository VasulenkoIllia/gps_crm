const ISO_DATE_LENGTH = 10;

// A business date is text, YYYY-MM-DD (packages/shared/src/dates.ts). Prisma has no type for it and carries midnight UTC.
export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, ISO_DATE_LENGTH);
}
