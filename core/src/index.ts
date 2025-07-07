import { Logger } from './types';

export * from './types';
export { createElectronBridgeGenerator } from './generator';

/**
 * Create a console logger
 * @returns The logger
 */
export const createConsoleLogger = () : Logger => {
  return {
    info: console.info,
    warn: console.warn,
    error: console.error
  };
};
