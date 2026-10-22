import { database } from '../src/database.js';
import { universities } from './universities.js';

try {
  // Una sola inserción evita 30 viajes a la base y el timeout de una transacción remota.
  await database.university.createMany({ data: universities, skipDuplicates: true });
  console.log(`Lista de instituciones preparada: ${universities.length}.`);
} finally {
  await database.$disconnect();
}
