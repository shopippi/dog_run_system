import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// A-10 アンケートの管理
export const surveyQuestionsRoutes = new Hono<AppEnv>();
