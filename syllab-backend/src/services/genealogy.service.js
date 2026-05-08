'use strict';

const { getClient } = require('../config/database');

/**
 * Check genealogy violations for detected techniques.
 *
 * A violation = using a technique without having demonstrated
 * its prerequisites in ANY previous submission.
 *
 * @param {string[]} currentTechniques - techniques detected in current submission
 * @param {string[]} historicalTechniques - techniques seen in all previous submissions
 * @param {Object} [prereqMap] - optional in-memory override for tests
 * @returns {Array<{technique, missingPrerequisite, severityWeight}>}
 */
async function checkGenealogyViolations(currentTechniques, historicalTechniques, prereqMap) {
  const prisma = getClient();
  const historicalSet = new Set(historicalTechniques);

  // Load prerequisite graph from DB (or use override)
  let graph = prereqMap;
  if (!graph) {
    const rows = await prisma.techniquePrerequisite.findMany();
    graph = {};
    for (const row of rows) {
      graph[row.technique] = { requires: row.requires, severityWeight: row.severityWeight };
    }
  }

  const violations = [];

  for (const technique of currentTechniques) {
    const entry = graph[technique];
    if (!entry || entry.requires.length === 0) continue;

    for (const prereq of entry.requires) {
      if (!historicalSet.has(prereq)) {
        violations.push({
          technique,
          missingPrerequisite: prereq,
          severityWeight: entry.severityWeight,
        });
      }
    }
  }

  return violations;
}

/**
 * Get all techniques seen across a student's submission history
 */
async function getHistoricalTechniques(studentId, courseId) {
  const prisma = getClient();

  const features = await prisma.submissionFeatures.findMany({
    where: { submission: { studentId, courseId } },
    select: { detectedTechniques: true },
  });

  return [...new Set(features.flatMap(f => f.detectedTechniques))];
}

module.exports = { checkGenealogyViolations, getHistoricalTechniques };
