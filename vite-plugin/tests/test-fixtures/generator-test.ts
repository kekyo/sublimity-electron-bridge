/**
 * Test fixture for async generator support
 * @decorator expose
 */
export async function* streamData(count: number): AsyncGenerator<string> {
  for (let i = 0; i < count; i++) {
    yield `Data item ${i}`;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * Stream numbers with a delay
 * @decorator expose
 */
export async function* streamNumbers(max: number, delay: number = 100): AsyncGenerator<number> {
  for (let i = 0; i <= max; i++) {
    yield i;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

/**
 * Stream file content line by line
 * @decorator expose fileService
 */
export async function* readFileLines(filePath: string): AsyncGenerator<string> {
  // Simulated file reading
  const lines = [
    'First line of the file',
    'Second line of the file',
    'Third line of the file'
  ];
  
  for (const line of lines) {
    yield line;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/**
 * Normal async function for comparison
 * @decorator expose
 */
export async function normalAsync(value: string): Promise<string> {
  return `Processed: ${value}`;
}

/**
 * Normal sync function for comparison
 * @decorator expose
 */
export function normalSync(value: number): number {
  return value * 2;
}