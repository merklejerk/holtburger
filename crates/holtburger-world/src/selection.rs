//! World-owned content-derived entity selection envelopes.

/// Unit-scale origin-centered sphere enclosing one effective animated visual profile.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SelectionEnvelope {
    radius: f32,
}

impl SelectionEnvelope {
    pub fn new(radius: f32) -> Result<Self, SelectionEnvelopeError> {
        if !radius.is_finite() || radius < 0.0 {
            return Err(SelectionEnvelopeError::InvalidRadius);
        }
        Ok(Self { radius })
    }

    /// Unit-scale radius; query placement applies current whole-object scale exactly once.
    pub const fn radius(self) -> f32 {
        self.radius
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SelectionEnvelopeError {
    #[error("selection-envelope radius must be finite and nonnegative")]
    InvalidRadius,
}
