# Programme S1 à S6 (coefficients)

`js/core/curriculum-data.js` est généré à partir des MCCC publiées par l'IUT de Montpellier-Sète
(site de Montpellier, formation initiale, 2025-2026) :

- BUT 1 (S1, S2) : <https://iut-montpellier-sete.edu.umontpellier.fr/files/2025/10/25-26-BUT-1-INFO-M-600.pdf>
- BUT 2 (S3, S4) : `25-26-BUT-2-INFO-M-RACDV-600.pdf`, `25-26-BUT-2-INFO-M-DACS-600.pdf`, `25-26-BUT-2-INFO-M-IAMSI-600.pdf`
- BUT 3 (S5, S6) : `25-26-BUT-3-INFO-M-RACDV-600.pdf`, `25-26-BUT-3-INFO-M-DACS-600.pdf`, `25-26-BUT-3-INFO-M-IAMSI-600.pdf`

(même dossier `files/2025/10/` que le premier lien.)

Pour une nouvelle année : télécharger les PDF dans un dossier, puis

```bash
for f in *.pdf; do pdftotext -layout "$f"; done
python3 build_curriculum.py        # écrit curriculum.json (adapter les noms de fichiers en bas du script)
node emit.mjs curriculum.json ../../js/core/curriculum-data.js "$PWD/../../js/core/program.js"
```

Relire ensuite `curriculum.json` (modules dont la somme ne correspond pas, valeurs absentes) et
lancer `npm test` : les tests vérifient notamment que le S1 reste identique au calcul d'origine.
