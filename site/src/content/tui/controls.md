---
title: 'TUI controls'
description: 'Keys depend on the focused pane and the selected entry.'
section: 'Terminal client'
presentation: reference
---

## Pane and input controls

| Control                  | Action                                        |
| ------------------------ | --------------------------------------------- |
| Tab                      | Focus the next pane                           |
| Shift+Tab                | Focus the previous pane                       |
| Enter in the chat pane   | Focus the input line                          |
| Enter in the input line  | Submit a message or command                   |
| Escape in the input line | Leave input                                   |
| Escape outside input     | Cancel an active interaction where applicable |
| Up / Down in input       | Browse submitted input history                |
| Ctrl+Q                   | Quit                                          |

Enter can activate a selected entry's footer action in a dashboard tab. To type a message reliably, switch to the chat pane with **Tab**, then press **Enter** to focus the input line. Tab cycles the display panes; it does not focus the input line.

## Dashboard tabs

With the dashboard focused, **1–7** select **Nearby, Inventory, Character, Spells, Equip, Trade, Party**, in that order.

Use the visible footer shortcuts for actions. They change with the tab, selection and current multi-step task. Lists support navigation and scrolling; the mouse wheel scrolls the pane under the pointer.

## Filters and quantities

Choose **Filter** where offered, enter the filter, then submit or cancel it before using other actions. Quantity prompts similarly take input until completed or canceled.

For a walkthrough, see [TUI basics](/holtburger/tui/basics/) and [gameplay](/holtburger/tui/gameplay/).
