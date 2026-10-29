CREATE UNIQUE INDEX "FormAssignment_formId_classId_key"
ON "FormAssignment"("formId", "classId");

CREATE UNIQUE INDEX "FormAssignment_formId_studentId_key"
ON "FormAssignment"("formId", "studentId");
