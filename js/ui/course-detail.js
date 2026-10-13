/** Détail complet d'une séance (au clic / tap) : rien n'est tronqué sans accès au détail. */
import { html, raw } from "../core/escape.js";
import { subjectName } from "../core/program.js";
import { parisTime, parisDayKey, formatLongDate, capitalize } from "../core/dates.js";
import { subjectColor } from "../core/timetable.js";
import { openModal } from "./modal.js";

export function openCourseDetail(ev) {
    const color = subjectColor(ev.subjectCode);
    const row = (icon, label, value) =>
        value
            ? html`<div class="flex gap-3 py-2 border-t border-slate-800">
                  <i class="fa-solid ${raw(icon)} text-slate-500 w-4 mt-0.5" aria-hidden="true"></i>
                  <div class="min-w-0"><p class="text-[11px] uppercase tracking-wider text-slate-500">${label}</p><p class="text-sm text-slate-100 break-words">${value}</p></div>
              </div>`
            : "";
    const when = ev.allDay ? `${capitalize(formatLongDate(parisDayKey(ev.start), { withYear: true }))} · toute la journée` : `${capitalize(formatLongDate(parisDayKey(ev.start), { withYear: true }))} · ${parisTime(ev.start)} – ${parisTime(ev.end)}`;
    openModal({
        title: "Détail de la séance",
        icon: "fa-calendar-day",
        body: html`<div class="space-y-1" data-course-detail>
            <div class="flex items-start gap-3 pb-2">
                <span class="w-1.5 self-stretch rounded-full ${raw(color.dot)}" aria-hidden="true"></span>
                <div class="min-w-0">
                    <p class="text-base font-semibold text-white break-words ${raw(ev.cancelled ? "line-through" : "")}">${ev.title}</p>
                    ${ev.cancelled ? html`<p class="text-xs font-bold uppercase text-rose-300 mt-1"><i class="fa-solid fa-ban" aria-hidden="true"></i> Séance annulée</p>` : ""}
                </div>
            </div>
            ${row("fa-clock", "Quand", when)}
            ${row("fa-location-dot", "Salle", ev.room || "Non précisée")}
            ${row("fa-book", "Matière", ev.subjectCode ? `${ev.subjectCode} — ${subjectName(ev.subjectCode)}` : "Non associée à une matière de l'application")}
            ${row("fa-chalkboard-user", "Type", ev.type)}
            ${row("fa-user", ev.teachers && ev.teachers.length > 1 ? "Enseignants" : "Enseignant", ev.teachers && ev.teachers.join(", "))}
            ${row("fa-users", "Groupe(s)", ev.groups && ev.groups.join(", "))}
            ${row("fa-circle-info", "Remarques", ev.remarks && ev.remarks.join(" · "))}
        </div>`
    });
}
