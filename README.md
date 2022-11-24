# Code Details
* Be sure to read setup notes for enviromental variables below

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 14.2.9.

## Run `npm install` to install npm packages

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.io/cli) page.

#
# Setup Notes Below
## Make sure to add an .env file with your API KEYs at root level of your project folder
Name variables exaclty as shown before the equals sign

 ```  
    FIREBASE_API_KEY = [FIRBASE-API-KEY]
    
    FIREBASE_AUTH_DOMAIN = [YOURAPP_NAME].firebaseapp.com
    
    FIREBASE_DATABASE_URL = https://[YOUR-APP-ANE].firebaseio.com
   
    FIREBASE_PROJECT_ID = [PROJECT-NAME]
    
    FIREBASE_STORAGE_BUCKET = [STORAGE-BUCKET-DOMAIN]
   
    FIREBASE_MESSAGING_SENDER_ID = [FIREBASE-SENDER-ID]
   
    FIREBASE_APP_ID = [YOUR-FIREBASE-APP-ID]
    
    FIREBASE_MEASUREMENT_ID = [MEASUREMENT-ID]
    
    ALGOLIA_APP_ID= [ALGOLIA-APP-ID]
    
    ALGOLIA_ADMIN_API_KEY = [ALGOLIA-API-KEY]
```
# 
### IN YOUR PACKAGE.JSON FILE

So that you have your environmental variables set at runtime,

The `setenv.ts` script will add the keys to your environment
```
 "scripts": {
    "ng": "ng",
    "config": "ts-node ./scripts/setenv.ts",
    "start": "npm run config -- --environment=dev && ng serve",
    "build": "npm run config -- --environment=prod && ng build",
    "watch": "ng build --watch --configuration development",
    "test": "ng test"
  },
  ```
#
#
#### Notes one firebase model, must match model src > app > models > tutorial.model.ts
```
export class Tutorial {
    id?: string;
    title?: string;
    description?: string;
    url?: string;
    img?: string;
    tags?: string[];
    pages?: string[];
  }
```