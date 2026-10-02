// A refusal from the file system. `invalid`: the request can never succeed as asked. `not-found`: the item, or a
// target's parent folder, is missing. `exists`: the target is already taken.
export type FileSystemErrorReason = 'invalid' | 'not-found' | 'exists';

export class FileSystemError extends Error {
  constructor(
    readonly reason: FileSystemErrorReason,
    message: string,
  ) {
    super(message);
  }
}
