// tests/types/global.d.ts
import { Sequelize } from 'sequelize';
import { SchemaSnapshot } from '../../src/db/schema/types';

declare global {
  var __TEST_SEQUELIZE__: Sequelize;
  var __TEST_SCHEMA__: SchemaSnapshot;
}

export {};