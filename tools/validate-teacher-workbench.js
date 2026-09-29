const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const mini = (...parts) => read("miniprogram", ...parts);

const app = JSON.parse(mini("app.json"));
assert(app.pages.includes("pages/teacher-workbench/index"), "Teacher workbench page is not registered");
assert.strictEqual(
  app.usingComponents && app.usingComponents["teacher-tabbar"],
  "/components/teacher-tabbar/index",
  "Teacher tab bar must be globally registered"
);
assert(!app.tabBar, "A native tab bar would leak teacher navigation to student accounts");

const tabbarJs = mini("components", "teacher-tabbar", "index.js");
const tabbarWxml = mini("components", "teacher-tabbar", "index.wxml");
assert(tabbarJs.includes('workbench: "/pages/teacher-workbench/index"'), "Teacher tab bar must route to the workbench");
["首页", "学生", "工作台"].forEach((label) => assert(tabbarWxml.includes(label), `Teacher tab bar is missing ${label}`));

const homeWxml = mini("pages", "index", "index.wxml");
const studentsJs = mini("pages", "students", "index.js");
const studentsWxml = mini("pages", "students", "index.wxml");
const detailWxml = mini("pages", "student-detail", "index.wxml");
const workbenchJs = mini("pages", "teacher-workbench", "index.js");
const workbenchWxml = mini("pages", "teacher-workbench", "index.wxml");

assert(homeWxml.includes('<teacher-tabbar wx:if="{{isTeacher}}"'), "Home tab bar must only render for teachers");
assert(studentsWxml.includes('<teacher-tabbar wx:if="{{isTeacher}}"'), "Student-list tab bar must only render for teachers");
assert(detailWxml.includes('<teacher-tabbar wx:if="{{isTeacher}}"'), "Student-detail tab bar must only render for teacher management mode");
assert(workbenchWxml.includes('<teacher-tabbar wx:if="{{isTeacher}}"'), "Workbench tab bar must only render after teacher authorization");

assert(studentsJs.includes('type: "setStudentVisibility"'), "Student list must call the visibility action");
assert(studentsJs.includes("hidden: true"), "Student list must hide without deleting");
assert(studentsWxml.includes('catchtap="hideStudent"'), "Hide action must not accidentally open the student card");
assert(workbenchJs.includes("includeHidden: true"), "Workbench must request hidden students");
assert(workbenchJs.includes("hidden: false"), "Workbench must support restoring students");
assert(workbenchWxml.includes("隐藏不会删除访问码、课程、错题或学习进度"), "Workbench must explain non-destructive hiding");

const backend = read("cloudfunctions", "quickstartFunctions", "index.js");
assert(backend.includes("const isStudentHiddenFromTeacher"), "Backend is missing visibility normalization");
assert(backend.includes('case "setStudentVisibility"'), "Backend dispatcher is missing visibility action");
assert(backend.includes("!isStudentHiddenFromTeacher(student)"), "Teacher views must filter hidden students");
assert(backend.includes("teacherHiddenUpdatedAt"), "Visibility changes must be timestamped");

console.log("Teacher workbench validation passed: teacher-only navigation, reversible hiding, filtering, and restore flow.");
