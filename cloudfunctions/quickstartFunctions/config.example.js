module.exports = {
  // Copy this file to config.js and fill in local production values.
  // config.js is intentionally ignored by Git and is still included when the
  // cloud function is deployed from the local WeChat Developer Tools project.
  teacherOpenIds: ["teacher-openid-placeholder"],
  teacherAccessCode: "teacher-access-code-placeholder",
  teacherName: "Teacher",
  defaultSubject: "English",
  sharedStudentAccessCodes: [],
  unlimitedStudentAccessCodes: [],
  seedStudents: [
    { name: "Example student", grade: "Grade", accessCode: "student-code-placeholder" },
  ],
  subscriptionTemplates: {
    lessonScheduleReminder: "template-id-placeholder",
  },
};
