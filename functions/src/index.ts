import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
//import  * as algoliasearch from 'algoliasearch';
//import algoliasearch from 'algoliasearch/lite';

// for the default version
const algoliasearch = require('algoliasearch');

// for the default version
//import algoliasearch from 'algoliasearch';

// for the search only version
//import algoliasearch from 'algoliasearch/lite';

admin.initializeApp();
require('dotenv').config();

const searchTutorialContent = algoliasearch(
    ...environment.ALGOLIA_APP_ID,
  );

const tutorialContentIndex = searchTutorialContent.initIndex('tutorialContent');

exports.onTutorialContentCreated = functions.firestore
    .document('tutorialContent/{tutorialContentId}')
    .onCreate((snap, context) => {
        const tutorialContent = snap.data();
        const objectID = snap.id;

        //add the data to the algolia index
        return tutorialContentIndex.saveObject({
            objectID,
            ...tutorialContent
        });
    });

exports.onTutorialContentUpdated = functions.firestore
    .document('tutorialContent/{tutorialContentId}')
    .onUpdate((change, context) => {
        const newData = change.after.data();
        const objectID = change.after.id;

        //update the data to the algolia index
        return tutorialContentIndex.saveObject({
            objectID,
            ...newData
        });
    }   
);

exports.onTutorialContentDeleted = functions.firestore
    .document('tutorialContent/{tutorialContentId}')
    .onDelete((snap, context) => {
        const objectID = snap.id;

        //delete the data from the algolia index
        return tutorialContentIndex.deleteObject(objectID);
    }
);   
