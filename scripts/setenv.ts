const { writeFile } = require('fs');
const { argv } = require('yargs');
// read environment variables from .env file
require('dotenv').config();
// read the command line arguments passed with yargs
const environment = argv.environment;
const isProduction = environment === 'prod';
//if the enviromental veriables dont load properly it will exit
//UPDATE TO ADD MORE ENVIRONMENTAL VARIABLES
if (//add more environmental variables here
    !process.env["FIREBASE_API_KEY"] ||
    !process.env["FIREBASE_AUTH_DOMAIN"] ||
    !process.env["FIREBASE_DATABASE_URL"] ||
    !process.env["FIREBASE_PROJECT_ID"] ||
    !process.env["FIREBASE_STORAGE_BUCKET"] ||
    !process.env["FIREBASE_MESSAGING_SENDER_ID"] ||
    !process.env["FIREBASE_APP_ID"] ||
    !process.env["FIREBASE_MEASUREMENT_ID"] ||
    !process.env["ALGOLIA_APP_ID"] ||
    !process.env["ALGOLIA_ADMIN_API_KEY"]
    ) {
   console.error('All the required environment variables were not provided!');
   process.exit(-1);
}
const targetPath = isProduction
   ? `./src/environments/environment.prod.ts`
   : `./src/environments/environment.ts`;
// we have access to our environment variables
// in the process.env object thanks to dotenv
const environmentFileContent = `
export const environment = {
   production: ${isProduction},
   firebase: {
      apiKey: "${process.env["FIREBASE_API_KEY"]}",
      authDomain: "${process.env["FIREBASE_AUTH_DOMAIN"]}",
      projectId: "${process.env["FIREBASE_PROJECT_ID"]}",
      storageBucket: "${process.env["FIREBASE_STORAGE_BUCKET"]}",
      messagingSenderId: "${process.env["FIREBASE_MESSAGING_SENDER_ID"]}",
      appId: "${process.env["FIREBASE_APP_ID"]}",
      measurementId: "${process.env["FIREBASE_MEASUREMENT_ID"]}"
    },
    algolia: {
      algoliaAPP_ID: "${process.env["ALGOLIA_APP_ID"]}",
      algoliaAdminAPI_KEY: "${process.env["ALGOLIA_ADMIN_API_KEY"]}"
    }
};
`;
// write the content to the respective file
writeFile(targetPath, environmentFileContent, function (err: any) {
   if (err) {
         console.log(err);
      }
      console.log(`Wrote variables to ${targetPath}`);
});