import { MongoClient, Db } from 'mongodb';

/**
 * @param {import('mongodb').Db} db
 * @returns {Boolean || Error}
 */

export let db: Db;
async function startDatabase() {
    if (!process.env.MongoURI)
        throw new Error('MongoURI not defined in environment variables');

    const connection = await MongoClient.connect(process.env.MongoURI)
        .catch(err => {
            return err;
        });

    /**
     * @param {MongoClient} connection
     */
    console.log(`[MongoDB] Successfully connected to DBNAME: ${connection.options.dbName}`);
    db = connection.db();
    return true;
}

export { startDatabase };