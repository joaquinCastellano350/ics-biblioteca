import { database } from '../../database.js';

export interface University {
  id: string;
  name: string;
}

export async function listUniversities(): Promise<University[]> {
  // Consulta fija: no recibe identificadores SQL ni valores del navegador.
  return database.$queryRaw<University[]>`
    SELECT id, name
    FROM public.universities
    ORDER BY name ASC, id ASC
  `;
}
