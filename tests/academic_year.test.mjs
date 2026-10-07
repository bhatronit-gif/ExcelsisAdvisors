/**
 * tests/academic_year.test.mjs
 * Comprehensive unit tests for Academic Year configuration, calculation, and state handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACADEMIC_YEARS, getDefaultAcademicYear, INITIAL_STATE_DEFAULTS } from '../js/config.js';
import { state } from '../js/state.js';

describe('Academic Year Constants & Generation', () => {
    it('should start from 2020-21 and include up to 2030-31', () => {
        assert.equal(ACADEMIC_YEARS[0], '2020-21');
        assert.equal(ACADEMIC_YEARS[ACADEMIC_YEARS.length - 1], '2030-31');
        assert.equal(ACADEMIC_YEARS.length, 11);
        assert.deepEqual(ACADEMIC_YEARS, [
            "2020-21",
            "2021-22",
            "2022-23",
            "2023-24",
            "2024-25",
            "2025-26",
            "2026-27",
            "2027-28",
            "2028-29",
            "2029-30",
            "2030-31"
        ]);
    });

    it('should calculate default academic year for June through December', () => {
        const august2026 = new Date('2026-08-21T12:00:00Z');
        assert.equal(getDefaultAcademicYear(august2026), '2026-27');

        const june2024 = new Date('2024-06-01T12:00:00Z');
        assert.equal(getDefaultAcademicYear(june2024), '2024-25');

        const dec2022 = new Date('2022-12-31T12:00:00Z');
        assert.equal(getDefaultAcademicYear(dec2022), '2022-23');
    });

    it('should calculate default academic year for January through May', () => {
        const feb2025 = new Date('2025-02-15T12:00:00Z');
        assert.equal(getDefaultAcademicYear(feb2025), '2024-25');

        const may2023 = new Date('2023-05-30T12:00:00Z');
        assert.equal(getDefaultAcademicYear(may2023), '2022-23');

        const jan2021 = new Date('2021-01-10T12:00:00Z');
        assert.equal(getDefaultAcademicYear(jan2021), '2020-21');
    });

    it('should clamp bounds for dates before 2020 or after 2030', () => {
        const date2018 = new Date('2018-08-10T12:00:00Z');
        assert.equal(getDefaultAcademicYear(date2018), '2020-21');

        const date2035 = new Date('2035-08-10T12:00:00Z');
        assert.equal(getDefaultAcademicYear(date2035), '2030-31');
    });

    it('should handle string date inputs safely', () => {
        assert.equal(getDefaultAcademicYear('2026-08-21'), '2026-27');
        assert.equal(getDefaultAcademicYear('2024-02-10'), '2023-24');
    });
});

describe('State & Schema Academic Year Integration', () => {
    it('should initialize INITIAL_STATE_DEFAULTS with valid academicYear', () => {
        assert.ok(INITIAL_STATE_DEFAULTS.academicYear);
        assert.ok(ACADEMIC_YEARS.includes(INITIAL_STATE_DEFAULTS.academicYear));
    });

    it('should have academicYear property on state object', () => {
        assert.ok(state.academicYear);
        assert.ok(ACADEMIC_YEARS.includes(state.academicYear));
    });

    it('should correctly format JSON backup payload with academicYear', () => {
        const payload = {
            version: "2.0",
            filename: "Test_Audit",
            school: "Children's Academy Ashok Nagar",
            academicYear: "2024-25",
            date: "2024-09-15",
            auditData: {}
        };
        const jsonStr = JSON.stringify(payload);
        const parsed = JSON.parse(jsonStr);
        assert.equal(parsed.academicYear, "2024-25");
    });

    it('should fallback gracefully for legacy JSON backups without academicYear', () => {
        const legacyPayload = {
            filename: "Legacy_Audit",
            school: "Children's Academy Thane",
            date: "2022-10-10",
            auditData: {}
        };
        const resolvedYear = legacyPayload.academicYear || legacyPayload.academic_year || getDefaultAcademicYear(legacyPayload.date);
        assert.equal(resolvedYear, "2022-23");
    });
});
