import express from 'express';
import { db } from '../../mongo.js';
import jwt from 'jsonwebtoken';

// Validate all environment variables needed
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not defined in environment variables');

const API_router = express.Router();



export { API_router, db, jwt };
export default API_router;