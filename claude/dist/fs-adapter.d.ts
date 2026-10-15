/**
 * The fs seam every file-touching module in this package goes through.
 *
 * The Claude environment hands plugins an async fs surface (whole-file read
 * and replace — no rename, no append); the host injects it here at wiring
 * time. Tests run the same modules over an in-memory stub.
 */
export interface FsAdapter {
    /** Read a whole file as text; null when it does not exist (never throws for a missing file). */
    read(path: string): Promise<string | null>;
    /** Write a whole file (replace). Creates parent directories where the surface allows. */
    write(path: string, content: string): Promise<void>;
    /** Whether a path exists. */
    exists?(path: string): Promise<boolean>;
}
