package com.enat.app

import com.enat.app.data.setup.SetupStateRepository
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MainViewModelTest {
    @Test
    fun `shows setup on a device that has never completed consent`() {
        val viewModel = MainViewModel(FakeSetupStateRepository(complete = false))

        assertTrue(viewModel.showSetup.value)
    }

    @Test
    fun `shows home once setup has completed`() {
        val viewModel = MainViewModel(FakeSetupStateRepository(complete = true))

        assertFalse(viewModel.showSetup.value)
    }

    @Test
    fun `finishing setup switches to home`() {
        val viewModel = MainViewModel(FakeSetupStateRepository(complete = false))

        viewModel.onSetupFinished()

        assertFalse(viewModel.showSetup.value)
    }

    private class FakeSetupStateRepository(
        private var complete: Boolean,
    ) : SetupStateRepository {
        override fun isSetupComplete(): Boolean = complete

        override fun markSetupComplete() {
            complete = true
        }
    }
}
