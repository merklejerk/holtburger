with open("apps/holtburger-cli/src/update/app_event.rs", "r") as f:
    lines = f.readlines()

start_idx = -1
for i, line in enumerate(lines):
    if "// GameState logic" in line:
        start_idx = i
        break

if start_idx != -1:
    # Look for the last line of that block
    # It ends with two closing braces before the final result/return
    new_lines = lines[:start_idx]
    new_lines.append("        // Delegate Page/GameState tick logic\n")
    new_lines.append("        result.merge(self.page.handle_tick(elapsed));\n")
    new_lines.append("\n")
    new_lines.append("        result\n")
    new_lines.append("    }\n")
    new_lines.append("}\n")
    
    with open("apps/holtburger-cli/src/update/app_event.rs", "w") as f:
        f.writelines(new_lines)
    print("Patched successfully")
else:
    print("Could not find GameState logic marker")
