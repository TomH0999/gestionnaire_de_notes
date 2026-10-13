/**
 * Réglages : compte et synchronisation, lien de l'emploi du temps (ADE), sauvegarde
 * (export / import JSON, sauvegardes automatiques), application, zone de danger.
 */
import { html, raw } from "../../core/escape.js";
import { parseEdtUrl, maskEdtUrl } from "../../core/edt-url.js";
import { formatDateTime } from "../../core/dates.js";
import { buildExport, exportFileName, planImport, applyImport } from "../../data/backup.js";
import { describeSyncState, syncPill } from "../sync-indicator.js";
import { render, on } from "../dom.js";
import { confirmDialog } from "../modal.js";
import { INPUT_CLASS, LABEL_CLASS, CARD_CLASS, PRIMARY_BTN, SECONDARY_BTN } from "../components.js";

const H2 = "text-base font-semibold text-white flex items-center gap-2 mb-4";

/** Téléchargement compatible iPhone (partage natif si disponible), comme la version d'origine. */
export async function downloadJson(fileName, text, toast) {
    if (navigator.share && navigator.canShare) {
        try {
            const file = new File([text], fileName, { type: "application/json" });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: "Sauvegarde des notes BUT1", text: "Sauvegarde de vos données BUT1 Informatique." });
                toast("Export partagé avec succès !");
                return;
            }
        } catch (err) {
            if (err && err.name === "AbortError") return; // partage annulé par l'utilisateur
        }
    }
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Export JSON généré avec succès !");
}

export function createSettingsPage(ctx) {
    let el = null;
    let showUrl = false;

    function accountSection() {
        const s = ctx.syncState();
        const d = describeSyncState(s);
        if (s.mode === "local") {
            return html`<section class="${raw(CARD_CLASS)}" aria-labelledby="set-account">
                <h2 id="set-account" class="${raw(H2)}"><i class="fa-solid fa-cloud text-brand-500" aria-hidden="true"></i> Compte et synchronisation</h2>
                <div class="flex flex-wrap items-center gap-3 mb-3" data-account-pill>${syncPill(s)}</div>
                <p class="text-sm text-slate-300">La synchronisation n'est pas encore configurée : vos données restent sur cet appareil (comme avant).</p>
                <p class="text-sm text-slate-400 mt-2">Pour synchroniser iPhone, PC fixe et PC portable : créez le projet Supabase gratuit puis renseignez <code class="text-brand-400">config.js</code> (guide « Configuration en 5 minutes » : <code class="text-brand-400">docs/CONFIGURATION.md</code>).</p>
            </section>`;
        }
        const signedIn = s.mode === "signed-in";
        const conflicts = ctx.repo().conflictLog();
        return html`<section class="${raw(CARD_CLASS)}" aria-labelledby="set-account">
            <h2 id="set-account" class="${raw(H2)}"><i class="fa-solid fa-cloud text-brand-500" aria-hidden="true"></i> Compte et synchronisation</h2>
            <div class="flex flex-wrap items-center gap-3 mb-2" data-account-pill>${syncPill(s)}</div>
            <p class="text-xs text-slate-400 mb-4" data-sync-detail>${d.detail}</p>
            ${
                signedIn
                    ? html`<div class="space-y-3">
                          <p class="text-sm text-slate-300">Connecté en tant que <strong class="text-white">${s.user && s.user.email ? s.user.email : "votre compte"}</strong>.</p>
                          <dl class="grid grid-cols-2 gap-2 text-xs">
                              <dt class="text-slate-500">Dernière synchronisation</dt><dd class="text-slate-200">${s.sync.lastSyncAt ? formatDateTime(s.sync.lastSyncAt) : "—"}</dd>
                              <dt class="text-slate-500">Modifications en attente</dt><dd class="text-slate-200" data-pending-count>${s.sync.pending}</dd>
                              <dt class="text-slate-500">Temps réel</dt><dd class="text-slate-200">${s.sync.realtime === "connected" ? "connecté" : s.sync.realtime === "connecting" ? "connexion…" : "en pause (rattrapage automatique)"}</dd>
                          </dl>
                          <div class="flex flex-wrap gap-2">
                              <button type="button" data-action="sync-now" class="${raw(PRIMARY_BTN)}"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> Synchroniser maintenant</button>
                              <button type="button" data-action="sign-out" class="${raw(SECONDARY_BTN)}"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Se déconnecter</button>
                          </div>
                      </div>`
                    : html`<form id="auth-form" novalidate class="space-y-3 max-w-md">
                          ${s.sessionExpired ? html`<p class="text-sm text-amber-300"><i class="fa-solid fa-user-clock" aria-hidden="true"></i> Votre session a expiré. Vos modifications sont conservées sur l'appareil : reconnectez-vous pour les envoyer.</p>` : ""}
                          <div>
                              <label for="auth-email" class="${raw(LABEL_CLASS)}">Adresse e-mail</label>
                              <input id="auth-email" name="email" type="email" autocomplete="username" inputmode="email" required value="${s.user && s.user.email ? s.user.email : ""}" class="${raw(INPUT_CLASS)}">
                          </div>
                          <div>
                              <label for="auth-password" class="${raw(LABEL_CLASS)}">Mot de passe</label>
                              <input id="auth-password" name="password" type="password" autocomplete="current-password" required minlength="6" class="${raw(INPUT_CLASS)}">
                          </div>
                          <p class="text-xs text-rose-400" data-auth-error hidden></p>
                          <div class="flex flex-wrap gap-2">
                              <button type="submit" class="${raw(PRIMARY_BTN)}"><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> Se connecter</button>
                              <button type="button" data-action="sign-up" class="${raw(SECONDARY_BTN)}"><i class="fa-solid fa-user-plus" aria-hidden="true"></i> Créer le compte</button>
                          </div>
                          <p class="text-[11px] text-slate-500">« Créer le compte » ne sert qu'une fois (puis désactivez les inscriptions dans Supabase). La session reste ouverte sur cet appareil.</p>
                      </form>`
            }
            ${
                conflicts.length
                    ? html`<details class="mt-4 bg-slate-950/80 border border-slate-800 rounded-xl">
                          <summary class="p-3 min-h-[44px] cursor-pointer text-sm text-slate-300">Journal des conflits résolus (${conflicts.length})</summary>
                          <ul class="px-3 pb-3 space-y-2 text-xs text-slate-400">${conflicts.slice(0, 30).map(
                              (c) => html`<li class="border-t border-slate-800 pt-2"><span class="text-slate-200">${formatDateTime(Date.parse(c.at))}</span> — ${c.label} : ${c.fields.map(
                                  (f) => html`<span class="block">champ « ${f.field} » : votre valeur ${JSON.stringify(f.valeurLocalePerdue)} a été remplacée par ${JSON.stringify(f.valeurGardee)} (modification plus récente).</span>`
                              )}</li>`
                          )}</ul>
                      </details>`
                    : ""
            }
        </section>`;
    }

    function timetableSection() {
        const url = ctx.repo().getSetting("edtUrl", "");
        const tt = ctx.timetable;
        return html`<section class="${raw(CARD_CLASS)}" aria-labelledby="set-edt">
            <h2 id="set-edt" class="${raw(H2)}"><i class="fa-solid fa-calendar-week text-brand-500" aria-hidden="true"></i> Emploi du temps (ADE)</h2>
            <form id="edt-form" novalidate class="space-y-3">
                <div>
                    <label for="edt-url" class="${raw(LABEL_CLASS)}">Lien de votre emploi du temps</label>
                    <div class="flex gap-2">
                        <input id="edt-url" name="edtUrl" type="${showUrl ? "url" : "password"}" autocomplete="off" spellcheck="false" placeholder="https://proseconsult.umontpellier.fr/direct/?data=…" value="${url}" class="${raw(INPUT_CLASS)} font-mono">
                        <button type="button" data-action="toggle-url" class="${raw(SECONDARY_BTN)} shrink-0 !px-3" aria-label="${showUrl ? "Masquer le lien" : "Afficher le lien"}" aria-pressed="${showUrl ? "true" : "false"}"><i class="fa-solid ${raw(showUrl ? "fa-eye-slash" : "fa-eye")}" aria-hidden="true"></i></button>
                    </div>
                    <p class="text-xs text-rose-400 mt-1" data-edt-error hidden></p>
                    <p class="text-[11px] text-slate-500 mt-1">${url ? html`Lien enregistré : <span class="font-mono">${maskEdtUrl(url)}</span>. ` : ""}Ce lien contient un jeton personnel : il est stocké dans vos réglages synchronisés (protégés, jamais dans le code). Il change en général à chaque semestre.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button type="submit" class="${raw(PRIMARY_BTN)}"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Enregistrer et actualiser</button>
                    ${url ? html`<button type="button" data-action="clear-url" class="${raw(SECONDARY_BTN)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i> Retirer le lien</button>` : ""}
                </div>
                <p class="text-xs text-slate-400" data-edt-state>${tt.status === "loading" ? "Récupération en cours…" : tt.error ? `Dernier essai : ${tt.error.message}` : tt.lastFetchedAt() ? `Dernière mise à jour : ${formatDateTime(tt.lastFetchedAt())} (${tt.cache.events.length} séances en cache).` : "Aucun emploi du temps en cache."}</p>
            </form>
        </section>`;
    }

    function backupSection() {
        const backups = ctx.store.getJSON("backups", []);
        return html`<section class="${raw(CARD_CLASS)}" aria-labelledby="set-backup">
            <h2 id="set-backup" class="${raw(H2)}"><i class="fa-solid fa-box-archive text-brand-500" aria-hidden="true"></i> Sauvegarde</h2>
            <div class="flex flex-wrap gap-2">
                <button type="button" id="export-btn" data-action="export" class="${raw(SECONDARY_BTN)}"><i class="fa-solid fa-upload text-brand-500" aria-hidden="true"></i> Exporter (JSON)</button>
                <label for="import-file" class="${raw(SECONDARY_BTN)} cursor-pointer"><i class="fa-solid fa-download text-brand-500" aria-hidden="true"></i> Importer (JSON)</label>
                <input type="file" id="import-file" accept=".json,application/json" class="sr-only" data-action="import">
            </div>
            <p class="text-[11px] text-slate-500 mt-2">L'export contient vos notes, devoirs et réglages (sans le lien ADE personnel). L'import accepte aussi les anciens exports ; il ajoute ou met à jour, sans jamais rien supprimer.</p>
            ${
                backups.length
                    ? html`<h3 class="text-sm font-semibold text-slate-300 mt-4 mb-2">Sauvegardes automatiques (avant migration)</h3>
                          <ul class="space-y-2">${backups.map(
                              (b) => html`<li class="flex flex-wrap items-center justify-between gap-2 text-xs bg-slate-950/80 border border-slate-800 rounded-xl p-3">
                                  <span class="text-slate-300">${formatDateTime(Date.parse(b.createdAt))} · ${b.count} note(s) de l'ancienne version</span>
                                  <button type="button" data-action="download-backup" data-backup="${b.id}" class="${raw(SECONDARY_BTN)} !min-h-[40px] text-xs"><i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i> Télécharger</button>
                              </li>`
                          )}</ul>`
                    : ""
            }
        </section>`;
    }

    function appSection() {
        const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
        return html`<section class="${raw(CARD_CLASS)}" aria-labelledby="set-app">
            <h2 id="set-app" class="${raw(H2)}"><i class="fa-solid fa-mobile-screen text-brand-500" aria-hidden="true"></i> Application</h2>
            <p class="text-sm text-slate-300">Version <span class="font-mono" data-app-version>${ctx.version}</span>${standalone ? " · installée sur l'appareil" : ""}.</p>
            ${standalone ? "" : html`<p class="text-xs text-slate-400 mt-2"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Sur iPhone, installez l'application (Safari → Partager → « Sur l'écran d'accueil ») : elle fonctionne alors hors-ligne et iOS conserve ses données.</p>`}
            <div class="flex flex-wrap gap-2 mt-3">
                <button type="button" data-action="check-update" class="${raw(SECONDARY_BTN)}"><i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i> Rechercher une mise à jour</button>
            </div>
        </section>`;
    }

    function dangerSection() {
        return html`<section class="${raw(CARD_CLASS)} border-red-500/20" aria-labelledby="set-danger">
            <h2 id="set-danger" class="${raw(H2)}"><i class="fa-solid fa-triangle-exclamation text-red-400" aria-hidden="true"></i> Zone de danger</h2>
            <button type="button" data-action="reset-grades" class="px-3 py-2 min-h-[44px] text-sm font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition border border-red-500/20 flex items-center gap-2">
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i> Effacer toutes les notes
            </button>
            <p class="text-[11px] text-slate-500 mt-2">Supprime toutes les notes sur tous vos appareils (suppression logique, synchronisée). Pensez à exporter avant.</p>
        </section>`;
    }

    function renderAll() {
        if (!el) return;
        const active = document.activeElement;
        if (active && el.contains(active) && active.matches("input")) {
            // Ne pas effacer une saisie en cours (mot de passe, lien) : mise à jour partielle
            const pill = el.querySelector("[data-account-pill]");
            if (pill) render(pill, syncPill(ctx.syncState()));
            return;
        }
        render(
            el,
            html`<div class="space-y-6 max-w-3xl">
                ${accountSection()} ${timetableSection()} ${backupSection()} ${appSection()} ${dangerSection()}
            </div>`
        );
    }

    async function handleAuth(kind) {
        const form = el.querySelector("#auth-form");
        if (!form) return;
        const email = form.elements.email.value.trim();
        const password = form.elements.password.value;
        const errorBox = form.querySelector("[data-auth-error]");
        errorBox.hidden = true;
        if (!email || !password) {
            errorBox.textContent = "Indiquez votre adresse e-mail et votre mot de passe.";
            errorBox.hidden = false;
            return;
        }
        const buttons = form.querySelectorAll("button");
        buttons.forEach((b) => (b.disabled = true));
        try {
            if (kind === "sign-up") {
                const r = await ctx.controller.signUp(email, password);
                if (r && r.needsConfirmation) ctx.toast("Compte créé : confirmez votre adresse via l'e-mail reçu, puis connectez-vous.", "info", { duration: 8000 });
                else ctx.toast("Compte créé et connecté. Pensez à désactiver les inscriptions dans Supabase.", "success", { duration: 6000 });
            } else {
                await ctx.controller.signIn(email, password);
                ctx.toast("Connecté : synchronisation en cours.");
            }
            (document.activeElement || {}).blur?.();
            renderAll();
        } catch (e) {
            errorBox.textContent = e && e.message ? e.message : "Connexion impossible.";
            errorBox.hidden = false;
        } finally {
            buttons.forEach((b) => (b.disabled = false));
        }
    }

    return {
        id: "reglages",
        mount(container) {
            el = container;
            on(el, "submit", "#auth-form", (e) => {
                e.preventDefault();
                handleAuth("sign-in");
            });
            on(el, "click", "[data-action=sign-up]", () => handleAuth("sign-up"));
            on(el, "click", "[data-action=sign-out]", async () => {
                const ok = await confirmDialog({ title: "Se déconnecter", message: "Vos données restent disponibles sur cet appareil ; la synchronisation reprendra à la reconnexion.", confirmLabel: "Se déconnecter", icon: "fa-right-from-bracket" });
                if (ok) {
                    await ctx.controller.signOut();
                    ctx.toast("Déconnecté.");
                    renderAll();
                }
            });
            on(el, "click", "[data-action=sync-now]", () => ctx.controller.syncNow({ full: true }));
            on(el, "click", "[data-action=toggle-url]", () => {
                const input = el.querySelector("#edt-url");
                showUrl = !showUrl;
                input.type = showUrl ? "url" : "password";
                const btn = el.querySelector("[data-action=toggle-url]");
                btn.setAttribute("aria-pressed", showUrl ? "true" : "false");
                btn.setAttribute("aria-label", showUrl ? "Masquer le lien" : "Afficher le lien");
                btn.querySelector("i").className = `fa-solid ${showUrl ? "fa-eye-slash" : "fa-eye"}`;
            });
            on(el, "submit", "#edt-form", (e) => {
                e.preventDefault();
                const input = el.querySelector("#edt-url");
                const errorBox = el.querySelector("[data-edt-error]");
                const parsed = parseEdtUrl(input.value);
                if (!parsed.ok) {
                    errorBox.textContent = parsed.error;
                    errorBox.hidden = false;
                    input.setAttribute("aria-invalid", "true");
                    input.focus();
                    return;
                }
                errorBox.hidden = true;
                input.removeAttribute("aria-invalid");
                ctx.repo().setSetting("edtUrl", input.value.trim());
                input.blur();
                ctx.toast("Lien de l'emploi du temps enregistré.");
                ctx.refreshTimetable(null, { manual: true });
                renderAll();
            });
            on(el, "click", "[data-action=clear-url]", async () => {
                const ok = await confirmDialog({ title: "Retirer le lien", message: "Retirer le lien de l'emploi du temps sur tous vos appareils ?", confirmLabel: "Retirer", danger: true });
                if (ok) {
                    ctx.repo().setSetting("edtUrl", "");
                    ctx.timetable.setSource(null);
                    renderAll();
                }
            });
            on(el, "click", "[data-action=export]", () => {
                const data = buildExport(ctx.repo(), { appVersion: ctx.version });
                downloadJson(exportFileName(), JSON.stringify(data, null, 2), ctx.toast);
            });
            on(el, "change", "[data-action=import]", (e, input) => {
                const file = input.files && input.files[0];
                input.value = "";
                if (!file) return;
                if (file.size > 5_000_000) {
                    ctx.toast("Fichier trop volumineux.", "error");
                    return;
                }
                const reader = new FileReader();
                reader.onload = async () => {
                    const plan = planImport(String(reader.result));
                    if (plan.error) {
                        ctx.toast(plan.error, "error");
                        return;
                    }
                    const total = plan.grades.length + plan.homework.length + plan.settings.length;
                    const ok = await confirmDialog({
                        title: "Importer une sauvegarde",
                        icon: "fa-download",
                        message: `${plan.kind === "legacy" ? "Ancien format détecté. " : ""}${plan.grades.length} note(s), ${plan.homework.length} devoir(s), ${plan.settings.length} réglage(s) seront ajoutés ou mis à jour${plan.rejected ? ` (${plan.rejected} entrée(s) invalide(s) ignorée(s))` : ""}. Rien ne sera supprimé. Continuer ?`,
                        confirmLabel: `Importer (${total})`
                    });
                    if (!ok) return;
                    const r = applyImport(ctx.repo(), plan);
                    ctx.toast(`Import terminé : ${r.added} ajouté(s), ${r.updated} mis à jour, ${r.unchanged} inchangé(s).`);
                };
                reader.onerror = () => ctx.toast("Erreur lors de la lecture du fichier.", "error");
                reader.readAsText(file);
            });
            on(el, "click", "[data-action=download-backup]", (e, b) => {
                const backup = ctx.store.getJSON("backups", []).find((x) => x.id === b.dataset.backup);
                if (backup) downloadJson(backup.fileName, backup.content, ctx.toast);
            });
            on(el, "click", "[data-action=check-update]", () => ctx.checkForUpdate(true));
            on(el, "click", "[data-action=reset-grades]", async () => {
                const n = ctx.repo().grades().length;
                if (n === 0) {
                    ctx.toast("Aucune note à effacer.", "info");
                    return;
                }
                const ok = await confirmDialog({ title: "Effacer toutes les notes", message: `Supprimer définitivement vos ${n} note(s) sur tous vos appareils ? Exportez d'abord si vous voulez les garder.`, confirmLabel: "Tout effacer", danger: true, icon: "fa-trash-can" });
                if (!ok) return;
                const repo = ctx.repo();
                repo.batch(() => repo.grades().forEach((g) => repo.remove(g.id)));
                ctx.toast("Toutes les notes ont été effacées.");
            });
            renderAll();
        },
        render: renderAll
    };
}
