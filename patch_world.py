with open("apps/holtburger-cli/src/update/world.rs", "r") as f:
    text = f.read()

# We can merge everything into a single match on `event`.
# Wait, handle_setup_event takes `&ClientViewEvent`. We could change it to take `ClientViewEvent` by value.
# Let's see what handle_setup_event does.
