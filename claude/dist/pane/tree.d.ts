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
    /** The surface drawing the pane (e.surface). Keyboard-driven hints are
     *  drawn only on surfaces whose controls take the keyboard (the desktop
     *  drives the pane with the pointer). */
    surface?: string;
}
export declare function buildPaneTree(els: PaneElements, controller: PaneController, options: PaneTreeOptions): unknown;
