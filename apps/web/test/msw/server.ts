import { setupServer } from 'msw/node';

export const server = setupServer();

/** Base URL the test API client uses (Node's fetch needs an absolute URL). */
export const API = 'http://localhost/api';
