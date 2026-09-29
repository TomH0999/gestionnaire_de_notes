/**
 * Programme du BUT1 Informatique (Ressources & SAÉ)
 */
const BUT1_PROGRAM = {
    1: {
        ressources: [
            { code: "R1.01", name: "Initiation au développement" },
            { code: "R1.02", name: "Développement d'interfaces web" },
            { code: "R1.03", name: "Architecture des ordinateurs" },
            { code: "R1.04", name: "Introduction aux systèmes d'exploitation" },
            { code: "R1.05", name: "Introduction aux réseaux" },
            { code: "R1.06", name: "Base de données & SQL" },
            { code: "R1.07", name: "Mathématiques discrètes" },
            { code: "R1.08", name: "Gestion de projet & Économie" },
            { code: "R1.09", name: "Introduction à la gestion" },
            { code: "R1.10", name: "Anglais technique S1" },
            { code: "R1.11", name: "Communication S1" },
            { code: "R1.12", name: "PPP - Projet Personnel & Pro" }
        ],
        saes: [
            { code: "SAÉ 1.01", name: "Implémentation d'un besoin client" },
            { code: "SAÉ 1.02", name: "Comparaison d'algorithmes" },
            { code: "SAÉ 1.03", name: "Installation poste de travail" },
            { code: "SAÉ 1.04", name: "Création d'une base de données" },
            { code: "SAÉ 1.05", name: "Recueil de besoins" },
            { code: "SAÉ 1.06", name: "Découverte de l'environnement pro" }
        ]
    },
    2: {
        ressources: [
            { code: "R2.01", name: "Développement orienté objet" },
            { code: "R2.02", name: "Développement d'applications IHM" },
            { code: "R2.03", name: "Qualité de développement" },
            { code: "R2.04", name: "Réseaux et services" },
            { code: "R2.05", name: "Services réseaux avancés" },
            { code: "R2.06", name: "Exploitation de bases de données" },
            { code: "R2.07", name: "Graphes et langages" },
            { code: "R2.08", name: "Analyse statistique" },
            { code: "R2.09", name: "Droit du numérique" },
            { code: "R2.10", name: "Anglais technique S2" },
            { code: "R2.11", name: "Communication d'entreprise S2" },
            { code: "R2.12", name: "PPP - Projet Personnel & Pro S2" }
        ],
        saes: [
            { code: "SAÉ 2.01", name: "Développement d'une application" },
            { code: "SAÉ 2.02", name: "Exploration algorithmique" },
            { code: "SAÉ 2.03", name: "Conception de site Web" },
            { code: "SAÉ 2.04", name: "Exploitation d'une base de données" },
            { code: "SAÉ 2.05", name: "Gestion d'un projet informatique" }
        ]
    }
};

// État de l'application
let currentSemester = 1;
let grades = [];
let activeFilter = 'all';
const STORAGE_KEY = "BUT1_INFO_GRADES_APP_DATA";

// Initialisation & Service Worker PWA
window.addEventListener("DOMContentLoaded", () => {
    registerServiceWorker();
    loadLocalStorageData();
    updateSubjectDropdowns();
    renderDashboard();
    renderGradesTable();
});

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.log('SW Registration skipped/failed:', err);
        });
    }
}

// LocalStorage
function loadLocalStorageData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            grades = JSON.parse(stored);
        } catch (e) {
            grades = [];
        }
    } else {
        // Exemples de départ
        grades = [
            { id: "1", semester: 1, name: "DS1 - Algorithmique", subjectCode: "R1.01", score: 14.5, max: 20, coeff: 1.5 },
            { id: "2", semester: 1, name: "Projet Web Mobile", subjectCode: "R1.02", score: 16.0, max: 20, coeff: 2.0 },
            { id: "3", semester: 1, name: "Livrable 1 - SAÉ", subjectCode: "SAÉ 1.01", score: 15.0, max: 20, coeff: 1.0 }
        ];
        saveToLocalStorage();
    }
}

function saveToLocalStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(grades));
}

// Changement de semestre
function switchSemester(sem) {
    currentSemester = sem;
    document.getElementById("sem-badge").textContent = `Semestre ${sem}`;
    
    document.getElementById("btn-sem-1").className = sem === 1 ? "px-3 py-1 rounded-md text-xs font-medium bg-brand-600 text-white shadow" : "px-3 py-1 rounded-md text-xs font-medium text-slate-400 hover:text-slate-200";
    document.getElementById("btn-sem-2").className = sem === 2 ? "px-3 py-1 rounded-md text-xs font-medium bg-brand-600 text-white shadow" : "px-3 py-1 rounded-md text-xs font-medium text-slate-400 hover:text-slate-200";

    updateSubjectDropdowns();
    renderDashboard();
    renderGradesTable();
}

// Mettre à jour les menus déroulants des disciplines
function updateSubjectDropdowns() {
    const addSelect = document.getElementById("grade-subject");
    const editSelect = document.getElementById("edit-grade-subject");
    const filterSelect = document.getElementById("table-filter-subject");

    const prog = BUT1_PROGRAM[currentSemester];
    let optionsHtml = `<optgroup label="Ressources (Matières)">`;
    prog.ressources.forEach(r => {
        optionsHtml += `<option value="${r.code}">${r.code} - ${r.name}</option>`;
    });
    optionsHtml += `</optgroup><optgroup label="SAÉ">`;
    prog.saes.forEach(s => {
        optionsHtml += `<option value="${s.code}">${s.code} - ${s.name}</option>`;
    });
    optionsHtml += `</optgroup>`;

    addSelect.innerHTML = optionsHtml;
    editSelect.innerHTML = optionsHtml;
    filterSelect.innerHTML = `<option value="">Toutes les matières</option>` + optionsHtml;
}

// Calcul des Moyennes
function calculateAverages() {
    const semGrades = grades.filter(g => g.semester === currentSemester);
    const prog = BUT1_PROGRAM[currentSemester];
    const allSubjects = [...prog.ressources, ...prog.saes];

    let subjectAverages = {};
    let totalWeightedPoints = 0;
    let totalCoeffs = 0;

    allSubjects.forEach(sub => {
        const subGrades = semGrades.filter(g => g.subjectCode === sub.code);
        if (subGrades.length > 0) {
            let scoreSum = 0;
            let coeffSum = 0;
            subGrades.forEach(g => {
                const normalizedGrade = (g.score / g.max) * 20;
                scoreSum += normalizedGrade * g.coeff;
                coeffSum += g.coeff;
            });
            const avg = coeffSum > 0 ? (scoreSum / coeffSum) : null;
            subjectAverages[sub.code] = avg;

            if (avg !== null) {
                totalWeightedPoints += avg * coeffSum;
                totalCoeffs += coeffSum;
            }
        } else {
            subjectAverages[sub.code] = null;
        }
    });

    const globalAverage = totalCoeffs > 0 ? (totalWeightedPoints / totalCoeffs) : null;

    return {
        globalAverage,
        subjectAverages,
        evalsCount: semGrades.length
    };
}

// Rendu du Tableau de Bord
function renderDashboard() {
    const { globalAverage, subjectAverages, evalsCount } = calculateAverages();

    const avgDisplay = document.getElementById("overall-average");
    if (globalAverage !== null) {
        avgDisplay.textContent = globalAverage.toFixed(2);
        if (globalAverage >= 10) {
            avgDisplay.className = "text-5xl sm:text-6xl font-extrabold text-emerald-400 tracking-tight";
        } else {
            avgDisplay.className = "text-5xl sm:text-6xl font-extrabold text-rose-400 tracking-tight";
        }
    } else {
        avgDisplay.textContent = "--";
        avgDisplay.className = "text-5xl sm:text-6xl font-extrabold text-white tracking-tight";
    }

    document.getElementById("total-evals-count").textContent = `${evalsCount} évaluation(s)`;

    // Grille des matières
    const container = document.getElementById("subject-averages-grid");
    container.innerHTML = "";

    const prog = BUT1_PROGRAM[currentSemester];
    let list = [...prog.ressources.map(r => ({ ...r, type: 'R' })), ...prog.saes.map(s => ({ ...s, type: 'SAE' }))];

    if (activeFilter === 'R') list = list.filter(item => item.type === 'R');
    if (activeFilter === 'SAE') list = list.filter(item => item.type === 'SAE');

    list.forEach(item => {
        const avg = subjectAverages[item.code];
        const card = document.createElement("div");
        card.className = "bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 flex flex-col justify-between hover:border-slate-700 transition";

        let avgBadge = `<span class="text-xs text-slate-500 font-mono">N/A</span>`;
        if (avg !== null) {
            const colorClass = avg >= 10 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-rose-400 bg-rose-500/10 border-rose-500/20";
            avgBadge = `<span class="text-xs font-bold font-mono px-1.5 py-0.5 rounded border ${colorClass}">${avg.toFixed(2)}</span>`;
        }

        card.innerHTML = `
            <div class="flex items-center justify-between mb-1">
                <span class="text-[10px] font-semibold text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded">${item.code}</span>
                ${avgBadge}
            </div>
            <p class="text-[11px] text-slate-300 font-medium truncate" title="${item.name}">${item.name}</p>
        `;
        container.appendChild(card);
    });
}

// Filtre des vignettes Synthèse
function setFilter(type) {
    activeFilter = type;
    ['all', 'R', 'SAE'].forEach(t => {
        const btn = document.getElementById(`filter-${t}`);
        if (t === type) {
            btn.className = "px-2.5 py-1 text-xs font-medium rounded-md bg-brand-600 text-white";
        } else {
            btn.className = "px-2.5 py-1 text-xs font-medium rounded-md bg-slate-800 text-slate-400 hover:text-slate-200";
        }
    });
    renderDashboard();
}

// Rendu du Tableau des Notes
function renderGradesTable() {
    const tbody = document.getElementById("grades-table-body");
    tbody.innerHTML = "";

    const searchQuery = document.getElementById("search-input").value.toLowerCase();
    const subjectFilter = document.getElementById("table-filter-subject").value;

    let filtered = grades.filter(g => g.semester === currentSemester);

    if (subjectFilter) {
        filtered = filtered.filter(g => g.subjectCode === subjectFilter);
    }

    if (searchQuery) {
        filtered = filtered.filter(g => g.name.toLowerCase().includes(searchQuery) || g.subjectCode.toLowerCase().includes(searchQuery));
    }

    document.getElementById("grades-count-badge").textContent = `${filtered.length} note(s)`;

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="py-8 text-center text-slate-500 italic">
                    Aucune évaluation enregistrée pour ces critères.
                </td>
            </tr>
        `;
        return;
    }

    filtered.forEach(g => {
        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-800/40 transition group";

        const normScore = (g.score / g.max) * 20;
        const scoreColor = normScore >= 10 ? "text-emerald-400" : "text-rose-400";

        tr.innerHTML = `
            <td class="py-3 px-4 font-medium text-slate-200">${escapeHtml(g.name)}</td>
            <td class="py-3 px-4">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                    ${g.subjectCode}
                </span>
            </td>
            <td class="py-3 px-4 text-center font-mono text-slate-400">${g.coeff}</td>
            <td class="py-3 px-4 text-right font-bold font-mono ${scoreColor}">${parseFloat(g.score)} / ${parseFloat(g.max)}</td>
            <td class="py-3 px-4 text-center">
                <div class="flex items-center justify-center space-x-2">
                    <button onclick="openEditModal('${g.id}')" class="p-1 hover:text-brand-400 text-slate-500 transition" title="Éditer">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button onclick="deleteGrade('${g.id}')" class="p-1 hover:text-red-400 text-slate-500 transition" title="Supprimer">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Ajouter une note
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
        semester: currentSemester,
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

    renderDashboard();
    renderGradesTable();
    showToast("Note ajoutée avec succès !");
}

// Supprimer une note
function deleteGrade(id) {
    if (confirm("Supprimer cette note ?")) {
        grades = grades.filter(g => g.id !== id);
        saveToLocalStorage();
        renderDashboard();
        renderGradesTable();
        showToast("Note supprimée.");
    }
}

// Édition (Modal)
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
        renderDashboard();
        renderGradesTable();
        closeEditModal();
        showToast("Note modifiée avec succès.");
    }
}

// Export / Import JSON
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(grades, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `notes_BUT1_Info_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("Export JSON effectué avec succès !");
}

function importData(event) {
    const fileReader = new FileReader();
    fileReader.onload = function(e) {
        try {
            const importedGrades = JSON.parse(e.target.result);
            if (Array.isArray(importedGrades)) {
                grades = importedGrades;
                saveToLocalStorage();
                renderDashboard();
                renderGradesTable();
                showToast("Données importées avec succès !");
            } else {
                showToast("Format du fichier JSON invalide.", "error");
            }
        } catch (err) {
            showToast("Erreur lors de la lecture du fichier.", "error");
        }
    };
    if (event.target.files[0]) {
        fileReader.readAsText(event.target.files[0]);
    }
}

// Réinitialisation
function confirmReset() {
    if (window.confirm("Êtes-vous sûr de vouloir tout réinitialiser ? Toutes vos notes seront effacées.")) {
        grades = [];
        saveToLocalStorage();
        renderDashboard();
        renderGradesTable();
        showToast("Toutes les données ont été réinitialisées.");
    }
}

// Toast Notifications
function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    
    const bgColor = type === "error" ? "bg-rose-600" : "bg-brand-600";
    
    toast.className = `${bgColor} text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 transform transition-all duration-300 pointer-events-auto opacity-0 translate-y-2`;
    toast.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i> ${escapeHtml(message)}`;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.remove("opacity-0", "translate-y-2");
    }, 10);

    setTimeout(() => {
        toast.classList.add("opacity-0", "translate-y-2");
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}