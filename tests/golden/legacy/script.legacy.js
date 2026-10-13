/**
 * Configuration & Coefficients BUT1 Informatique S1
 */
const PROGRAM_S1 = {
    ressources: [
        { code: "R1.01", name: "Initiation au développement" },
        { code: "R1.02", name: "Développement d'interfaces web" },
        { code: "R1.03", name: "Introduction à l'architecture des ordinateurs" },
        { code: "R1.04", name: "Introduction aux systèmes d'exploitation" },
        { code: "R1.05", name: "Introduction aux bases de données" },
        { code: "R1.06", name: "Mathématiques discrètes" },
        { code: "R1.07", name: "Outils mathématiques fondamentaux" },
        { code: "R1.08", name: "Gestion de projet & Organisation" },
        { code: "R1.09", name: "Économie durable et numérique" },
        { code: "R1.10", name: "Anglais technique" },
        { code: "R1.11", name: "Bases de la communication" },
        { code: "R1.12", name: "PPP - Projet Personnel et Professionnel" }
    ],
    saes: [
        { code: "SAE 1.01", name: "Implémentation d'un besoin client" },
        { code: "SAE 1.02", name: "Comparaison d'approches algorithmiques" },
        { code: "SAE 1.03", name: "Installation d'un poste pour le dev." },
        { code: "SAE 1.04", name: "Création d'une base de données" },
        { code: "SAE 1.05", name: "Recueil de besoins" },
        { code: "SAE 1.06", name: "Découverte de l'environnement éco." }
    ],
    ues: [
        { code: "UE 1.1", name: "Réaliser un développement d'application" },
        { code: "UE 1.2", name: "Optimiser des applications" },
        { code: "UE 1.3", name: "Administrer des systèmes informatiques" },
        { code: "UE 1.4", name: "Gérer des données de l'information" },
        { code: "UE 1.5", name: "Conduire un projet" },
        { code: "UE 1.6", name: "Travailler dans une équipe informatique" }
    ]
};

// Matrice des coefficients stricts par UE
const COEFFICIENTS_UE = {
    "UE 1.1": { "SAE 1.01": 40, "R1.01": 42, "R1.02": 12, "R1.10": 6 },
    "UE 1.2": { "SAE 1.02": 40, "R1.01": 24, "R1.03": 3, "R1.04": 3, "R1.06": 15, "R1.07": 15 },
    "UE 1.3": { "SAE 1.03": 40, "R1.03": 21, "R1.04": 21, "R1.10": 12, "R1.11": 6 },
    "UE 1.4": { "SAE 1.04": 40, "R1.05": 36, "R1.06": 18, "R1.09": 6 },
    "UE 1.5": { "SAE 1.05": 40, "R1.02": 18, "R1.08": 27, "R1.11": 15 },
    "UE 1.6": { "SAE 1.06": 40, "R1.02": 5, "R1.08": 11, "R1.09": 11, "R1.10": 11, "R1.11": 11, "R1.12": 11 }
};

// État global de l'application
let grades = [];
const STORAGE_KEY = "BUT1_INFO_S1_GRADES";

window.addEventListener("DOMContentLoaded", () => {
    registerServiceWorker();
    loadLocalStorageData();
    updateSubjectDropdowns();
    renderApp();
});

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('SW error:', err));
    }
}

function loadLocalStorageData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            grades = JSON.parse(stored);
        } catch (e) {
            grades = [];
        }
    } else {
        // Données d'exemple initiales
        grades = [
            { id: "1", name: "Contrôle TP1", subjectCode: "R1.01", score: 15, max: 20, coeff: 1 },
            { id: "2", name: "Projet HTML/CSS", subjectCode: "R1.02", score: 14, max: 20, coeff: 2 },
            { id: "3", name: "Evaluation SAE", subjectCode: "SAE 1.01", score: 16, max: 20, coeff: 1 }
        ];
        saveToLocalStorage();
    }
}

function saveToLocalStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(grades));
}

function updateSubjectDropdowns() {
    const addSelect = document.getElementById("grade-subject");
    const editSelect = document.getElementById("edit-grade-subject");

    let optionsHtml = `<optgroup label="Ressources (Matières)">`;
    PROGRAM_S1.ressources.forEach(r => {
        optionsHtml += `<option value="${r.code}">${r.code} - ${r.name}</option>`;
    });
    optionsHtml += `</optgroup><optgroup label="SAÉ">`;
    PROGRAM_S1.saes.forEach(s => {
        optionsHtml += `<option value="${s.code}">${s.code} - ${s.name}</option>`;
    });
    optionsHtml += `</optgroup>`;

    addSelect.innerHTML = optionsHtml;
    editSelect.innerHTML = optionsHtml;
}

/**
 * Calculs stricts conformes au fichier Excel BUT1
 */
function calculateAllAverages() {
    // 1. Calcul des moyennes individuelles des Matières (Ressources) et SAÉ
    const subjectAverages = {};
    const allItems = [...PROGRAM_S1.ressources, ...PROGRAM_S1.saes];

    allItems.forEach(item => {
        const itemGrades = grades.filter(g => g.subjectCode === item.code);
        if (itemGrades.length > 0) {
            let scoreSum = 0;
            let coeffSum = 0;
            itemGrades.forEach(g => {
                const normScore = (g.score / g.max) * 20;
                scoreSum += normScore * g.coeff;
                coeffSum += g.coeff;
            });
            subjectAverages[item.code] = coeffSum > 0 ? (scoreSum / coeffSum) : null;
        } else {
            subjectAverages[item.code] = null;
        }
    });

    // 2. Calcul des Moyennes d'UE (UE 1.1 à UE 1.6)
    const ueAverages = {};
    PROGRAM_S1.ues.forEach(ue => {
        const coeffsMap = COEFFICIENTS_UE[ue.code];
        let weightedSum = 0;
        let totalCoeffs = 0;

        for (const [subCode, coeff] of Object.entries(coeffsMap)) {
            const avg = subjectAverages[subCode];
            // Ignorer les éléments sans note dans le numérateur et le dénominateur
            if (avg !== null && avg !== undefined) {
                weightedSum += avg * coeff;
                totalCoeffs += coeff;
            }
        }

        ueAverages[ue.code] = totalCoeffs > 0 ? (weightedSum / totalCoeffs) : null;
    });

    // 3. Calcul de la Moyenne Générale (Moyenne simple des 6 UE)
    const validUeValues = Object.values(ueAverages).filter(val => val !== null);
    const globalAverage = validUeValues.length > 0 
        ? validUeValues.reduce((a, b) => a + b, 0) / validUeValues.length 
        : null;

    // 4. Détermination du Statut d'obtention
    let status = "Non calculé";
    let statusClass = "bg-slate-800 text-slate-400 border-slate-700";

    if (validUeValues.length === 6) {
        const countUnder10 = validUeValues.filter(v => v < 10).length;
        const hasUnder8 = validUeValues.some(v => v < 8);

        if (countUnder10 > 2 || hasUnder8) {
            status = "NON (Refusé)";
            statusClass = "bg-rose-500/20 text-rose-400 border-rose-500/30";
        } else if (countUnder10 >= 1) {
            status = "OUI avec rattrapage";
            statusClass = "bg-amber-500/20 text-amber-400 border-amber-500/30";
        } else {
            status = "OUI (Validé)";
            statusClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
        }
    } else if (validUeValues.length > 0) {
        status = "En cours d'évaluation";
        statusClass = "bg-brand-500/20 text-brand-400 border-brand-500/30";
    }

    return {
        subjectAverages,
        ueAverages,
        globalAverage,
        status,
        statusClass,
        totalEvals: grades.length
    };
}

/**
 * Mises à jour de l'interface
 */
function renderApp() {
    const data = calculateAllAverages();

    // 1. En-tête : Moyenne générale & Statut
    const avgDisplay = document.getElementById("overall-average");
    if (data.globalAverage !== null) {
        avgDisplay.textContent = data.globalAverage.toFixed(2);
        avgDisplay.className = data.globalAverage >= 10 
            ? "text-5xl sm:text-6xl font-extrabold text-emerald-400 tracking-tight"
            : "text-5xl sm:text-6xl font-extrabold text-rose-400 tracking-tight";
    } else {
        avgDisplay.textContent = "--";
        avgDisplay.className = "text-5xl sm:text-6xl font-extrabold text-white tracking-tight";
    }

    const statusBadge = document.getElementById("status-badge");
    statusBadge.textContent = data.status;
    statusBadge.className = `inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${data.statusClass}`;

    document.getElementById("total-evals-count").textContent = `${data.totalEvals} évaluation(s) saisie(s)`;

    // 2. Grille des Moyennes d'UE
    const ueGrid = document.getElementById("ue-averages-grid");
    ueGrid.innerHTML = "";
    PROGRAM_S1.ues.forEach(ue => {
        const avg = data.ueAverages[ue.code];
        const card = document.createElement("div");
        card.className = "bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between";

        let avgBadge = `<span class="text-xs text-slate-500 font-mono">--</span>`;
        if (avg !== null) {
            const colorClass = avg >= 10 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-rose-400 bg-rose-500/10 border-rose-500/20";
            avgBadge = `<span class="text-xs font-bold font-mono px-2 py-0.5 rounded border ${colorClass}">${avg.toFixed(2)}</span>`;
        }

        card.innerHTML = `
            <div class="flex items-center justify-between mb-1">
                <span class="text-xs font-semibold text-brand-400">${ue.code}</span>
                ${avgBadge}
            </div>
            <p class="text-[11px] text-slate-400 truncate" title="${ue.name}">${ue.name}</p>
        `;
        ueGrid.appendChild(card);
    });

    // 3. Rendu des Ressources en Accordéon
    renderRessourcesAccordion(data.subjectAverages);

    // 4. Rendu des SAÉ en bloc simple
    renderSAEBlocks(data.subjectAverages);
}

function renderRessourcesAccordion(subjectAverages) {
    const container = document.getElementById("ressources-accordion-container");
    container.innerHTML = "";

    PROGRAM_S1.ressources.forEach(res => {
        const avg = subjectAverages[res.code];
        const resGrades = grades.filter(g => g.subjectCode === res.code);

        let avgBadge = `<span class="text-xs text-slate-500 font-mono">Sans note</span>`;
        if (avg !== null) {
            const colorClass = avg >= 10 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-rose-400 bg-rose-500/10 border-rose-500/20";
            avgBadge = `<span class="text-xs font-bold font-mono px-2 py-0.5 rounded border ${colorClass}">${avg.toFixed(2)} / 20</span>`;
        }

        const details = document.createElement("details");
        details.className = "bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden group";

        let gradesListHtml = "";
        if (resGrades.length === 0) {
            gradesListHtml = `<p class="text-xs text-slate-500 italic p-3 text-center">Aucune évaluation enregistrée.</p>`;
        } else {
            gradesListHtml = `<div class="divide-y divide-slate-800/60">`;
            resGrades.forEach(g => {
                const normScore = (g.score / g.max) * 20;
                const scoreColor = normScore >= 10 ? "text-emerald-400" : "text-rose-400";
                gradesListHtml += `
                    <div class="p-3 flex items-center justify-between text-xs hover:bg-slate-900/50 transition">
                        <div>
                            <span class="font-medium text-slate-200 block">${escapeHtml(g.name)}</span>
                            <span class="text-[10px] text-slate-400">Coeff: ${g.coeff}</span>
                        </div>
                        <div class="flex items-center space-x-3">
                            <span class="font-bold font-mono ${scoreColor}">${g.score} / ${g.max}</span>
                            <button onclick="openEditModal('${g.id}')" class="p-1 hover:text-brand-400 text-slate-500 transition" title="Modifier">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            <button onclick="deleteGrade('${g.id}')" class="p-1 hover:text-red-400 text-slate-500 transition" title="Supprimer">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            });
            gradesListHtml += `</div>`;
        }

        details.innerHTML = `
            <summary class="p-3.5 flex items-center justify-between cursor-pointer select-none bg-slate-900/80 hover:bg-slate-800/60 transition">
                <div class="flex items-center space-x-2">
                    <i class="fa-solid fa-chevron-right text-xs text-slate-500 transition-transform duration-200 group-open:rotate-90"></i>
                    <span class="text-xs font-bold text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded">${res.code}</span>
                    <span class="text-xs font-medium text-slate-200">${res.name}</span>
                </div>
                ${avgBadge}
            </summary>
            <div class="bg-slate-950 border-t border-slate-800">
                ${gradesListHtml}
            </div>
        `;

        container.appendChild(details);
    });
}

function renderSAEBlocks(subjectAverages) {
    const container = document.getElementById("saes-list-container");
    container.innerHTML = "";

    PROGRAM_S1.saes.forEach(sae => {
        const avg = subjectAverages[sae.code];
        const saeGrades = grades.filter(g => g.subjectCode === sae.code);

        let avgBadge = `<span class="text-xs text-slate-500 font-mono">N/A</span>`;
        if (avg !== null) {
            const colorClass = avg >= 10 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-rose-400 bg-rose-500/10 border-rose-500/20";
            avgBadge = `<span class="text-xs font-bold font-mono px-2 py-0.5 rounded border ${colorClass}">${avg.toFixed(2)} / 20</span>`;
        }

        const block = document.createElement("div");
        block.className = "bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex flex-col space-y-2";

        let listHtml = "";
        if (saeGrades.length > 0) {
            listHtml = `<div class="mt-2 pt-2 border-t border-slate-800/80 space-y-1.5">`;
            saeGrades.forEach(g => {
                const normScore = (g.score / g.max) * 20;
                const scoreColor = normScore >= 10 ? "text-emerald-400" : "text-rose-400";
                listHtml += `
                    <div class="flex items-center justify-between text-xs">
                        <span class="text-slate-400">${escapeHtml(g.name)} (Coeff ${g.coeff})</span>
                        <div class="flex items-center space-x-2">
                            <span class="font-bold font-mono ${scoreColor}">${g.score}/${g.max}</span>
                            <button onclick="openEditModal('${g.id}')" class="p-1 hover:text-brand-400 text-slate-500"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="deleteGrade('${g.id}')" class="p-1 hover:text-red-400 text-slate-500"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `;
            });
            listHtml += `</div>`;
        }

        block.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2">
                    <span class="text-xs font-bold text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded">${sae.code}</span>
                    <span class="text-xs font-medium text-slate-200">${sae.name}</span>
                </div>
                ${avgBadge}
            </div>
            ${listHtml}
        `;

        container.appendChild(block);
    });
}

/**
 * Handlers d'actions
 */
function handleAddGrade(event) {
    event.preventDefault();

    const name = document.getElementById("grade-name").value.trim();
    const subjectCode = document.getElementById("grade-subject").value;
    const score = parseFloat(document.getElementById("grade-score").value);
    const max = parseFloat(document.getElementById("grade-max").value);
    const coeff = parseFloat(document.getElementById("grade-coeff").value);

    if (!name || isNaN(score) || isNaN(max) || isNaN(coeff)) {
        showToast("Veuillez remplir correctement tous les champs.", "error");
        return;
    }

    const newGrade = {
        id: Date.now().toString(),
        name,
        subjectCode,
        score,
        max,
        coeff
    };

    grades.push(newGrade);
    saveToLocalStorage();

    document.getElementById("grade-name").value = "";
    document.getElementById("grade-score").value = "";
    document.getElementById("grade-max").value = "20";
    document.getElementById("grade-coeff").value = "1.0";

    renderApp();
    showToast("Note ajoutée avec succès !");
}

function deleteGrade(id) {
    if (confirm("Supprimer cette évaluation ?")) {
        grades = grades.filter(g => g.id !== id);
        saveToLocalStorage();
        renderApp();
        showToast("Évaluation supprimée.");
    }
}

function openEditModal(id) {
    const grade = grades.find(g => g.id === id);
    if (!grade) return;

    document.getElementById("edit-grade-id").value = grade.id;
    document.getElementById("edit-grade-name").value = grade.name;
    document.getElementById("edit-grade-subject").value = grade.subjectCode;
    document.getElementById("edit-grade-score").value = grade.score;
    document.getElementById("edit-grade-max").value = grade.max || 20;
    document.getElementById("edit-grade-coeff").value = grade.coeff;

    document.getElementById("edit-modal").classList.remove("hidden");
}

function closeEditModal() {
    document.getElementById("edit-modal").classList.add("hidden");
}

function handleSaveEdit(event) {
    event.preventDefault();
    const id = document.getElementById("edit-grade-id").value;
    const grade = grades.find(g => g.id === id);

    if (grade) {
        grade.name = document.getElementById("edit-grade-name").value.trim();
        grade.subjectCode = document.getElementById("edit-grade-subject").value;
        grade.score = parseFloat(document.getElementById("edit-grade-score").value);
        grade.max = parseFloat(document.getElementById("edit-grade-max").value);
        grade.coeff = parseFloat(document.getElementById("edit-grade-coeff").value);

        saveToLocalStorage();
        renderApp();
        closeEditModal();
        showToast("Modification enregistrée.");
    }
}

/**
 * Correction de l'exportation compatible iOS Safari
 */
async function exportData() {
    const fileName = `notes_BUT1_S1_${new Date().toISOString().slice(0,10)}.json`;
    const jsonStr = JSON.stringify(grades, null, 2);

    // Utilisation prioritaire de la Web Share API pour iOS Safari / Mobile
    if (navigator.share) {
        try {
            const file = new File([jsonStr], fileName, { type: "application/json" });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: "Export des notes BUT1",
                    text: "Sauvegarde de vos notes BUT1 Informatique S1."
                });
                showToast("Export partagé avec succès !");
                return;
            }
        } catch (err) {
            // Reconstitution en fallback si annulé ou non pris en charge
        }
    }

    // Fallback standard Blob / Data URI
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.target = "_blank";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast("Export JSON généré avec succès !");
}

function importData(event) {
    const fileReader = new FileReader();
    fileReader.onload = function(e) {
        try {
            const importedGrades = JSON.parse(e.target.result);
            if (Array.isArray(importedGrades)) {
                grades = importedGrades;
                saveToLocalStorage();
                renderApp();
                showToast("Données importées avec succès !");
            } else {
                showToast("Format JSON non valide.", "error");
            }
        } catch (err) {
            showToast("Erreur lors de la lecture du fichier.", "error");
        }
    };
    if (event.target.files[0]) {
        fileReader.readAsText(event.target.files[0]);
    }
}

function confirmReset() {
    if (window.confirm("Réinitialiser toutes vos données ? Cette action est irréversible.")) {
        grades = [];
        saveToLocalStorage();
        renderApp();
        showToast("Toutes les données ont été réinitialisées.");
    }
}

function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    const bgColor = type === "error" ? "bg-rose-600" : "bg-brand-600";
    
    toast.className = `${bgColor} text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 transform transition-all duration-300 pointer-events-auto opacity-0 translate-y-2`;
    toast.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i> ${escapeHtml(message)}`;
    
    container.appendChild(toast);
    setTimeout(() => toast.classList.remove("opacity-0", "translate-y-2"), 10);
    setTimeout(() => {
        toast.classList.add("opacity-0", "translate-y-2");
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}