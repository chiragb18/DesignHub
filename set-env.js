const fs = require('fs');
const path = require('path');
require('dotenv').config();

const targetPath = path.join(__dirname, 'src/environments/environment.prod.ts');

const envConfigFile = `export const environment = {
    production: true,
    firebase: {
        apiKey: "${process.env.FIREBASE_API_KEY}",
        authDomain: "${process.env.FIREBASE_AUTH_DOMAIN}",
        projectId: "${process.env.FIREBASE_PROJECT_ID}",
        storageBucket: "${process.env.FIREBASE_STORAGE_BUCKET}",
        messagingSenderId: "${process.env.FIREBASE_MESSAGING_SENDER_ID}",
        appId: "${process.env.FIREBASE_APP_ID}"
    }
};
`;

console.log('Generating production environment file...');
fs.writeFileSync(targetPath, envConfigFile);
console.log(`Environment file generated at ${targetPath}`);
