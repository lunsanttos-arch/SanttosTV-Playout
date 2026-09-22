from pathlib import Path

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"anchor missing: {label}")
    return text.replace(old, new, 1)

# App.tsx
p = Path("src/renderer/src/App.tsx")
t = p.read_text(encoding="utf-8")

t = replace_once(
    t,
    "interface MediaItem {",
    "export interface MediaItem {",
    "export MediaItem"
)

anchor = '''interface WatermarkStyle {'''
insert = '''export interface RundownItem extends MediaItem {
    rundownItemId: string;
    sourceMediaId: string;
    notes: string;
}

interface WatermarkStyle {'''
t = replace_once(t, anchor, insert, "RundownItem interface")

t = t.replace(
    "items: MediaItem[];\n                updatedAt?: string | null;",
    "items: RundownItem[];\n                updatedAt?: string | null;",
    1
)
t = t.replace(
    "items: MediaItem[];\n            }) => Promise<{",
    "items: RundownItem[];\n            }) => Promise<{",
    1
)
t = t.replace(
    "items: MediaItem[];\n                };\n                error?: string;",
    "items: RundownItem[];\n                };\n                error?: string;",
    1
)

t = replace_once(
    t,
    '''                .map((entry) => {''',
    '''                .map((entry): MediaItem | null => {''',
    "timeline map return type"
)

p.write_text(t, encoding="utf-8")

# OpecSchedulerPanel.tsx
p = Path("src/renderer/src/OpecSchedulerPanel.tsx")
t = p.read_text(encoding="utf-8")

t = replace_once(
    t,
    '''import { useEffect, useMemo, useState } from "react";
import "./opec-scheduler.css";

interface MediaItem {
    id: string;
    sourceMediaId?: string;
    name: string;
    path: string;
    extension: string;
    duration: number | null;
    inPoint?: number;
    outPoint?: number | null;
    blockLabel?: string;
    watermark?: boolean;
    hashtag?: string;
}

interface RundownItem extends MediaItem {
    rundownItemId: string;
    sourceMediaId: string;
    notes: string;
}
''',
    '''import { useEffect, useMemo, useState } from "react";
import type { MediaItem, RundownItem } from "./App";
import "./opec-scheduler.css";
''',
    "shared rundown types"
)

t = t.replace(
    "updatedAt?: string;",
    "updatedAt?: string | null;",
    1
)

p.write_text(t, encoding="utf-8")
print("QA type fixes applied")
