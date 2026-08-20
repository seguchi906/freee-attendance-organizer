import type { Employee, SanitizedAttendanceRow } from "@/lib/attendance-types";

export function isActive(employee: Employee, month: string) {
  return employee.startMonth <= month && (!employee.endMonth || employee.endMonth >= month);
}

export function compareEmployees(employees: Employee[], rows: SanitizedAttendanceRow[], month: string) {
  const byCode = new Map(employees.map((employee) => [employee.employeeCode, employee]));
  const importedCodes = new Set(rows.map((row) => row.employeeCode));
  return {
    newEmployees: rows.filter((row) => !byCode.has(row.employeeCode)),
    surnameMismatches: rows
      .filter((row) => byCode.has(row.employeeCode) && byCode.get(row.employeeCode)?.surname !== row.surname)
      .map((row) => ({ employeeCode: row.employeeCode, currentSurname: byCode.get(row.employeeCode)!.surname, newSurname: row.surname })),
    missingEmployees: employees.filter((employee) => isActive(employee, month) && !importedCodes.has(employee.employeeCode)),
  };
}

export function previousMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

