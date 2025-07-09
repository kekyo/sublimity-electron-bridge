import { Logger } from './types';

export * from './types';
export { createElectronBridgeGenerator } from './generator';

/**
 * Create a console logger
 * @param prefix - Optional prefix
 * @returns The logger
 */
export const createConsoleLogger = (prefix?: string) : Logger => {
  return prefix ? {
    info: msg => console.info(`[${prefix}]: ${msg}`),
    warn: msg =>console.warn(`[${prefix}]: ${msg}`),
    error: msg =>console.error(`[${prefix}]: ${msg}`)
  } : {
    info: console.info,
    warn: console.warn,
    error: console.error
  };
};
