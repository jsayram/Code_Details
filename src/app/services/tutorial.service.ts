import { Injectable } from '@angular/core';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';
import { Tutorial } from '../models/tutorial.model';

@Injectable({
  providedIn: 'root'
})
export class TutorialService {
  private dbPath = '/tutorialContent';

  tutorialsRef: AngularFirestoreCollection<Tutorial>;

  constructor(private db: AngularFirestore) {
    // Initialize the AngularFirestoreCollection with the database path
    this.tutorialsRef = db.collection<Tutorial>(this.dbPath);
  }

  /**
   * Get all tutorials.
   * @returns An AngularFirestoreCollection containing all tutorials.
   */
  getAll(): AngularFirestoreCollection<Tutorial> {
    return this.tutorialsRef;
  }

  /**
   * Create a new tutorial.
   * @param tutorial - The tutorial to be created.
   * @returns A promise with the result of the creation operation.
   */
  create(tutorial: Tutorial): Promise<any> {
    // Add the tutorial to the AngularFirestoreCollection
    return this.tutorialsRef.add({ ...tutorial });
  }

  /**
   * Update an existing tutorial.
   * @param id - The ID of the tutorial to be updated.
   * @param data - The updated data for the tutorial.
   * @returns A promise with the result of the update operation.
   */
  update(id: string, data: any): Promise<void> {
    // Update the tutorial with the specified ID
    return this.tutorialsRef.doc(id).update(data);
  }

  /**
   * Delete a tutorial.
   * @param id - The ID of the tutorial to be deleted.
   * @returns A promise with the result of the delete operation.
   */
  delete(id: string): Promise<void> {
    // Delete the tutorial with the specified ID
    return this.tutorialsRef.doc(id).delete();
  }
}
