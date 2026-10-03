const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const mini = (...parts) => read("miniprogram", ...parts);

const app = JSON.parse(mini("app.json"));
assert(app.pages.includes("pages/teacher-workbench/index"), "Teacher workbench page is not registered");
assert(app.pages.includes("pages/teacher-todos/index"), "Teacher todo page is not registered");
assert.strictEqual(
  app.usingComponents && app.usingComponents["teacher-tabbar"],
  "/components/teacher-tabbar/index",
  "Teacher tab bar must be globally registered"
);
assert(!app.tabBar, "A native tab bar would leak teacher navigation to student accounts");

const tabbarJs = mini("components", "teacher-tabbar", "index.js");
const tabbarWxml = mini("components", "teacher-tabbar", "index.wxml");
assert(tabbarJs.includes('workbench: "/pages/teacher-workbench/index"'), "Teacher tab bar must route to the workbench");
assert(tabbarJs.includes('todos: "/pages/teacher-todos/index"'), "Teacher tab bar must route to persistent todos");
["首页", "待办", "管理"].forEach((label) => assert(tabbarWxml.includes(label), `Teacher tab bar is missing ${label}`));
assert(!tabbarWxml.includes('<view class="tab-label">学生</view>'), "Student management must not occupy a teacher tab");

const homeWxml = mini("pages", "index", "index.wxml");
const studentsJs = mini("pages", "students", "index.js");
const studentsWxml = mini("pages", "students", "index.wxml");
const detailWxml = mini("pages", "student-detail", "index.wxml");
const workbenchJs = mini("pages", "teacher-workbench", "index.js");
const workbenchWxml = mini("pages", "teacher-workbench", "index.wxml");
const todosJs = mini("pages", "teacher-todos", "index.js");
const todosWxml = mini("pages", "teacher-todos", "index.wxml");

assert(homeWxml.includes('<teacher-tabbar wx:if="{{isTeacher}}"'), "Home tab bar must only render for teachers");
assert(studentsWxml.includes('<teacher-tabbar wx:if="{{isTeacher}}"'), "Student-list tab bar must only render for teachers");
assert(detailWxml.includes('<teacher-tabbar wx:if="{{isTeacher}}"'), "Student-detail tab bar must only render for teacher management mode");
assert(workbenchWxml.includes('<teacher-tabbar wx:if="{{isTeacher}}"'), "Workbench tab bar must only render after teacher authorization");
assert(todosWxml.includes('<teacher-tabbar wx:if="{{isTeacher}}"'), "Todo tab bar must only render after teacher authorization");
assert(studentsWxml.includes('current="workbench"'), "Student list must sit inside the management section");
assert(detailWxml.includes('current="workbench"'), "Student detail must sit inside the management section");
assert(todosWxml.includes('current="todos"'), "Todo page must highlight the todo tab");

assert(studentsJs.includes('type: "setStudentVisibility"'), "Student list must call the visibility action");
assert(studentsJs.includes("hidden: true"), "Student list must hide without deleting");
assert(studentsWxml.includes('catchtap="hideStudent"'), "Hide action must not accidentally open the student card");
assert(workbenchJs.includes("includeHidden: true"), "Workbench must request hidden students");
assert(workbenchJs.includes("hidden: false"), "Workbench must support restoring students");
assert(workbenchWxml.includes("隐藏不会删除访问码、课程、错题或学习进度"), "Workbench must explain non-destructive hiding");
assert(todosJs.includes('type: "getTeacherTodos"'), "Todo page must load persistent teacher todos");
assert(todosJs.includes('activeFilter: "all"'), "Todo page must support task filtering");
assert(todosJs.includes('&focus=" + focus'), "Todo actions must deep-link to the relevant lesson section");
assert(todosWxml.includes("不会因为“已查看”而提前消失"), "Todo page must explain persistent resolution semantics");
assert(todosWxml.includes("只统计小程序内可确认"), "Inactivity copy must state its evidence boundary");

const backend = read("cloudfunctions", "quickstartFunctions", "index.js");
assert(backend.includes("const isStudentHiddenFromTeacher"), "Backend is missing visibility normalization");
assert(backend.includes('case "setStudentVisibility"'), "Backend dispatcher is missing visibility action");
assert(backend.includes("!isStudentHiddenFromTeacher(student)"), "Teacher views must filter hidden students");
assert(backend.includes("teacherHiddenUpdatedAt"), "Visibility changes must be timestamped");
assert(backend.includes('case "getTeacherTodos"'), "Backend dispatcher is missing teacher todos");
assert(backend.includes("teacherTodos.buildTeacherTodos"), "Backend must use the tested todo aggregator");

console.log("Teacher navigation validation passed: home, persistent todos, management, reversible hiding, and evidence-bounded alerts.");
