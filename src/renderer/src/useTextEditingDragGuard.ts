import { useRef, useState, type FocusEvent, type PointerEvent } from "react";

const textControl = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

function isTextControl(target: EventTarget | null) {
    return target instanceof Element && !!target.closest(textControl);
}

/** Disable native ancestor dragging before the browser starts selecting text. */
export function useTextEditingDragGuard() {
    const [editing, setEditing] = useState(false);
    const disabled = useRef<HTMLElement[]>([]);

    function update(root: HTMLElement, active: boolean) {
        if (active) {
            // Pointer capture runs before focus/default selection and React's commit.
            for (const element of root.querySelectorAll<HTMLElement>('[draggable="true"]')) {
                element.draggable = false;
                disabled.current.push(element);
            }
        } else {
            for (const element of disabled.current) {
                if (root.contains(element)) element.draggable = true;
            }
            disabled.current = [];
        }
        setEditing(active);
    }

    return {
        editing,
        handlers: {
            onPointerDownCapture(event: PointerEvent<HTMLElement>) {
                update(event.currentTarget, isTextControl(event.target));
            },
            onFocusCapture(event: FocusEvent<HTMLElement>) {
                update(event.currentTarget, isTextControl(event.target));
            },
            onBlurCapture(event: FocusEvent<HTMLElement>) {
                update(event.currentTarget, event.currentTarget.contains(event.relatedTarget as Node | null) && isTextControl(event.relatedTarget));
            }
        }
    };
}
