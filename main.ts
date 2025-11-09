import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';

import { startDatabase } from './mongo.js';
import { startAgenda } from './agenda/lifecycle.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(morgan('dev'));
app.use(cors());
app.use(express.json());

import authRoute from './routes/auth/auth.js';
app.use('/auth', authRoute);

import apiRoute from './routes/api/api.js';
import { getAgenda } from './agenda/index.js';
import { JobNames } from './agenda/jobNames.js';
app.use('/api', apiRoute);

app.get('/', (req, res) => {
    res.send(`API for ${process.env.APP_NAME} is online`);
});

function startServer(attempts = 0) {
    startDatabase()
        .then(() => {
            app.listen(port, () => {
                console.log(`[Express] App running on ${port}`)
            })
        })
        .catch(err => {
            if (attempts > 5) {
                console.error(`[MongoDB] Failed to connect to DB. Exiting...`);
                process.exit(1);
            }
            console.log(`[MongoDB] Failed to connect to DB. Reconnecting to MongoDB in 2 seconds.`)
            console.error(err);
            setTimeout(() => {
                startServer(attempts + 1);
            }, 2000);
        });

    startAgenda()
        .then(async () => {
            console.log('[Agenda] Agenda worker started');
        })
        .catch(err => {
            console.error('[Agenda] Failed to start Agenda worker');
            console.error(err);
        });
}

startServer();