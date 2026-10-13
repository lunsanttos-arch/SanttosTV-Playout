import { useEffect, useRef, useState } from "react";

function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export default function StyledDatePicker({ value, onChange }: { value: string; onChange: (date: string) => void }) {
    const [open, setOpen] = useState(false);
    const [month, setMonth] = useState(() => new Date(`${value}T12:00:00`));
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
        const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
        document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
        return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
    }, []);
    const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
    const days = Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay() + index, 12));
    return <div className="calendar-control" ref={root}>
        <button type="button" aria-expanded={open} onClick={() => { setMonth(new Date(`${value}T12:00:00`)); setOpen(!open); }}>
            {new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR")} ▾</button>
        {open && <div className="calendar-popover" role="dialog" aria-label="Calendário da programação">
            <div className="calendar-nav"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))}>‹</button>
                <strong>{month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</strong>
                <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))}>›</button></div>
            <div className="calendar-grid">{["D", "S", "T", "Q", "Q", "S", "S"].map((day, index) => <span key={index}>{day}</span>)}
                {days.map(day => <button key={dateKey(day)} className={`${dateKey(day) === value ? "active" : ""} ${day.getMonth() !== month.getMonth() ? "outside" : ""}`}
                    aria-label={day.toLocaleDateString("pt-BR")} onClick={() => { onChange(dateKey(day)); setOpen(false); }}>{day.getDate()}</button>)}</div>
            <button onClick={() => { onChange(dateKey(new Date())); setOpen(false); }}>Hoje</button>
        </div>}
    </div>;
}
