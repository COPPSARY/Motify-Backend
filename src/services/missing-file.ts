import { ObjectNotFoundError } from '../../packages/object-storage/types.js';
import { AppError } from '../errors.js';

/**
 * A row can outlive its file (storage cleared by hand, a bucket reset). That
 * is a missing file, not a server fault: answer 404 so the editor can show a
 * placeholder instead of an error.
 */
export async function orMissingFile<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      throw new AppError(404, 'ASSET_FILE_MISSING', 'This file is no longer available. Upload it again.');
    }
    throw error;
  }
}
