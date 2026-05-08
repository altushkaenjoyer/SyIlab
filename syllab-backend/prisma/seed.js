'use strict';

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Technique dependency graph — from SylLab-Forensics-Plan §5
const TECHNIQUE_PREREQUISITES = [
  { technique: 'circuit_breaker',        requires: ['decorators', 'context_managers', 'error_handling_advanced'], severityWeight: 0.9 },
  { technique: 'repository_pattern',     requires: ['classes', 'abstract_base_classes', 'dependency_injection'],   severityWeight: 0.8 },
  { technique: 'async_await_advanced',   requires: ['async_basics', 'event_loop_concepts'],                        severityWeight: 0.7 },
  { technique: 'custom_metaclasses',     requires: ['oop_advanced', 'decorators'],                                  severityWeight: 0.9 },
  { technique: 'dependency_injection',   requires: ['classes', 'interfaces'],                                       severityWeight: 0.7 },
  { technique: 'service_layer',          requires: ['classes', 'error_handling_basic'],                             severityWeight: 0.6 },
  { technique: 'abstract_base_classes',  requires: ['classes', 'inheritance'],                                      severityWeight: 0.6 },
  { technique: 'decorators',             requires: ['functions_advanced', 'closures'],                              severityWeight: 0.5 },
  { technique: 'context_managers',       requires: ['classes', 'error_handling_basic'],                             severityWeight: 0.5 },
  { technique: 'custom_exceptions',      requires: ['classes', 'error_handling_basic'],                             severityWeight: 0.4 },
  { technique: 'type_hints_advanced',    requires: ['type_hints_basic'],                                            severityWeight: 0.3 },
  { technique: 'async_basics',           requires: ['functions_advanced'],                                          severityWeight: 0.4 },
  { technique: 'closures',               requires: ['functions_advanced'],                                          severityWeight: 0.4 },
  { technique: 'inheritance',            requires: ['classes'],                                                      severityWeight: 0.3 },
  // Base techniques (no prerequisites)
  { technique: 'functions_advanced',     requires: [],  severityWeight: 0.1 },
  { technique: 'classes',               requires: [],  severityWeight: 0.1 },
  { technique: 'error_handling_basic',  requires: [],  severityWeight: 0.1 },
  { technique: 'type_hints_basic',      requires: [],  severityWeight: 0.1 },
  { technique: 'interfaces',            requires: [],  severityWeight: 0.1 },
  { technique: 'event_loop_concepts',   requires: [],  severityWeight: 0.1 },
  { technique: 'oop_advanced',          requires: ['classes', 'inheritance'], severityWeight: 0.5 },
  { technique: 'error_handling_advanced', requires: ['error_handling_basic', 'custom_exceptions'], severityWeight: 0.5 },
];

async function seed() {
  console.log('🌱 Seeding technique prerequisites...');

  for (const tp of TECHNIQUE_PREREQUISITES) {
    await prisma.techniquePrerequisite.upsert({
      where: { technique: tp.technique },
      update: { requires: tp.requires, severityWeight: tp.severityWeight },
      create: tp,
    });
  }

  // Seed a demo institution + cohort for testing
  const institution = await prisma.institution.upsert({
    where: { name: 'Demo University' },
    update: {},
    create: { name: 'Demo University' },
  });

  const cohort = await prisma.cohort.upsert({
    where: { id: 'demo-cohort-2025' },
    update: {},
    create: { id: 'demo-cohort-2025', name: 'CS101 Spring 2025' },
  });

  console.log(`✅ Seeded ${TECHNIQUE_PREREQUISITES.length} technique prerequisites`);
  console.log(`✅ Demo institution: ${institution.id}`);
  console.log(`✅ Demo cohort: ${cohort.id}`);
}

seed()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
