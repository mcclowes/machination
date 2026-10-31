/**
 * Keep report evidence serialized across whole-database cloning, including unsupported JSON.
 * @format
 */
type Archive = { format: 'message-report-source.v1'; source: string };
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function archived(value: unknown): value is Archive {
  return (
    object(value) &&
    Object.keys(value).length === 2 &&
    value.format === 'message-report-source.v1' &&
    typeof value.source === 'string'
  );
}

/** Persistence adapters may return parsed objects without their original JSON source. */
function serialize(value: unknown): string {
  type Task =
    | { kind: 'value'; value: unknown }
    | { kind: 'text'; value: string }
    | { kind: 'leave'; value: object };
  const tasks: Task[] = [{ kind: 'value', value }];
  const ancestors = new Set<object>();
  const output: string[] = [];
  while (tasks.length) {
    const task = tasks.pop()!;
    if (task.kind === 'text') {
      output.push(task.value);
      continue;
    }
    if (task.kind === 'leave') {
      ancestors.delete(task.value);
      continue;
    }
    const item = task.value;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') {
      output.push(JSON.stringify(item));
      continue;
    }
    if (typeof item === 'number') {
      output.push(
        item === Infinity
          ? '1e999'
          : item === -Infinity
            ? '-1e999'
            : Object.is(item, -0)
              ? '-0'
              : String(item),
      );
      continue;
    }
    if (typeof item !== 'object') {
      output.push(`[Unsupported ${typeof item}]`);
      continue;
    }
    if (ancestors.has(item)) {
      output.push('[Circular report state]');
      continue;
    }
    ancestors.add(item);
    const array = Array.isArray(item);
    const names = array
      ? Array.from({ length: item.length }, (_, index) => String(index))
      : Object.keys(item);
    output.push(array ? '[' : '{');
    tasks.push({ kind: 'leave', value: item }, { kind: 'text', value: array ? ']' : '}' });
    for (let index = names.length - 1; index >= 0; index--) {
      const name = names[index]!;
      tasks.push({ kind: 'value', value: (item as Record<string, unknown>)[name] });
      if (!array) tasks.push({ kind: 'text', value: JSON.stringify(name) + ':' });
      if (index) tasks.push({ kind: 'text', value: ',' });
    }
  }
  return output.join('');
}

export function archiveReportState(value: unknown, source?: string): unknown {
  if (value === undefined || archived(value)) return value;
  return {
    format: 'message-report-source.v1',
    source: source ?? serialize(value),
  } satisfies Archive;
}
export function serializedReportState(source: string): unknown {
  const value: unknown = JSON.parse(source);
  return archiveReportState(value, source);
}
export function reportState(value: unknown): unknown {
  return archived(value) ? JSON.parse(value.source) : value;
}
export function protectReportState(stored: unknown): unknown {
  return object(stored) && Object.hasOwn(stored, 'messageReports')
    ? { ...stored, messageReports: archiveReportState(stored.messageReports) }
    : stored;
}

/** JSON.parse has already checked syntax; scan iteratively so deep future values stay opaque. */
export function reportMemberSource(source: string): string | undefined {
  let cursor = 0,
    result: string | undefined;
  const whitespace = () => {
    while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++;
  };
  const stringEnd = (start: number) => {
    let index = start + 1;
    while (index < source.length) {
      if (source[index] === '\\') index += 2;
      else if (source[index++] === '"') return index;
    }
    return source.length;
  };
  const valueEnd = (start: number) => {
    if (source[start] === '"') return stringEnd(start);
    if (source[start] !== '{' && source[start] !== '[') {
      let index = start;
      while (index < source.length && source[index] !== ',' && source[index] !== '}') index++;
      return index;
    }
    let depth = 0;
    for (let index = start; index < source.length; index++) {
      const character = source[index];
      if (character === '"') index = stringEnd(index) - 1;
      else if (character === '{' || character === '[') depth++;
      else if ((character === '}' || character === ']') && --depth === 0) return index + 1;
    }
    return source.length;
  };
  whitespace();
  if (source[cursor++] !== '{') return undefined;
  while (cursor < source.length) {
    whitespace();
    if (source[cursor] !== '"') break;
    const end = stringEnd(cursor);
    const name: unknown = JSON.parse(source.slice(cursor, end));
    cursor = end;
    whitespace();
    cursor++;
    whitespace();
    const start = cursor;
    cursor = valueEnd(start);
    if (name === 'messageReports') result = source.slice(start, cursor);
    whitespace();
    if (source[cursor++] !== ',') break;
  }
  return result;
}
