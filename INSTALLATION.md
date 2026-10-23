# Block Party NYC : mise en route

Trois étapes, environ 20 minutes au total. Faites-les depuis un ordinateur.

## 1. Créer votre clé Google Maps (10 min)

1. Allez sur https://console.cloud.google.com et connectez-vous avec votre compte Google.
2. Créez un projet, par exemple « Block Party ».
3. Google vous demande d'activer la facturation : ajoutez une carte bancaire. Chaque service Google Maps a un quota gratuit chaque mois. L'usage de deux personnes pendant une semaine devrait y rester, mais par sécurité, créez une **alerte de budget** à 5 € (menu Facturation → Budgets et alertes).
4. Dans « API et services → Bibliothèque », activez :
   - **Maps JavaScript API**
   - **Places API (New)**
5. Dans « API et services → Identifiants », cliquez sur **Créer des identifiants → Clé API**, puis copiez la clé.
6. Cliquez sur la clé pour la **restreindre** :
   - Restrictions d'application : **Sites web**, puis ajoutez l'adresse de votre app (étape 2), par exemple `https://votre-pseudo.github.io/*`.
   - Restrictions d'API : cochez uniquement les deux API ci-dessus.

Ouvrez `config.js` et collez la clé entre les guillemets de `GOOGLE_MAPS_KEY`. Profitez-en pour mettre vos prénoms et l'emplacement de votre hôtel.

## 2. Mettre l'app en ligne (5 min, gratuit)

**Option simple : Netlify Drop**
1. Allez sur https://app.netlify.com/drop.
2. Glissez-déposez le dossier `blockparty` entier.
3. Netlify vous donne une adresse en `https://….netlify.app`. Ajoutez-la aux restrictions de la clé (étape 1.6).

**Option recommandée : GitHub Pages**, pour que Claude puisse ajouter des lieux pour vous.
1. Créez un compte sur https://github.com puis un dépôt nommé `blockparty`.
2. Envoyez tous les fichiers du dossier dans ce dépôt (bouton « Add file → Upload files »).
3. Dans le dépôt : **Settings → Pages → Branch : main → Save**. Votre app est en ligne à `https://votre-pseudo.github.io/blockparty/` en une minute.
4. Dans Claude, connectez GitHub et donnez-lui le nom du dépôt. Ensuite, il suffit d'envoyer une adresse à Claude : il l'ajoute dans `places.json` avec sa fiche, et elle apparaît dans l'app environ une minute après.

## 3. Installer l'app sur vos iPhone

1. Ouvrez l'adresse de l'app dans **Safari**.
2. Touchez le bouton Partager, puis **Sur l'écran d'accueil**.
3. À la première ouverture, autorisez la **localisation** : c'est ce qui permet « autour de moi ».

## Bon à savoir

- Vos ajouts, coches et votes sont enregistrés dans chaque téléphone. Pour les partager : onglet **Carnet → Copier mon code**, envoyez-le par message, et votre partenaire fait **Coller un code**.
- Sans clé Google, l'app fonctionne quand même avec une carte simplifiée, sans note Google ni recherche.
- La « Note BP » est une synthèse faite par Claude en octobre 2026. La note Google affichée dans chaque fiche est en direct.
