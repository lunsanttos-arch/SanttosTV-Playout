import { useEffect, useRef, useState } from "react";

export default function TimelineHashtagInput({ value, onCommit }: {
    value: string;
    onCommit: (value: string) => void;
}) {
    const [draft, setDraft] = useState(value);
    const focused = useRef(false);
    useEffect(() => {
        if (!focused.current) setDraft(value);
    }, [value]);
    return <input
        value={draft}
        placeholder="Hashtag"
        maxLength={80}
        onFocus={() => { focused.current = true; }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
            focused.current = false;
            onCommit(draft);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") event.currentTarget.blur();
        }}
    />;
}
