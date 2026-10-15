import type { PaneController } from "./controller.js";
/** The element constructors a surface provides (the subset this tree uses). */
export interface PaneElements {
    Box: (props: Record<string, unknown>) => unknown;
    Text: (props: Record<string, unknown>) => unknown;
    Button: (props: Record<string, unknown>) => unknown;
    Input: (props: Record<string, unknown>) => unknown;
    Select: (props: Record<string, unknown>) => unknown;
}
export interface PaneTreeOptions {
    /** Cells available for the body (e.props.bodyColumns from the render envelope). */
    bodyColumns: number;
    /** A dirty marker in the footer (the unsaved-changes hint). */
    dirty?: boolean;
}
export declare function buildPaneTree(els: PaneElements, controller: PaneController, options: PaneTreeOptions): unknown;
