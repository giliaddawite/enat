package com.enat.app.ui.home

import app.cash.turbine.test
import com.enat.app.MainDispatcherRule
import com.enat.app.data.greeting.GreetingRepository
import com.enat.app.data.greeting.TimeOfDay
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.io.IOException

class HomeViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    @Test
    fun `state is loading before the greeting resolves`() =
        runTest {
            val viewModel = HomeViewModel(FakeGreetingRepository(Result.success(TimeOfDay.MORNING)))

            assertEquals(HomeUiState.Loading, viewModel.uiState.value)
        }

    @Test
    fun `state becomes greeting when the repository succeeds`() =
        runTest {
            val viewModel = HomeViewModel(FakeGreetingRepository(Result.success(TimeOfDay.EVENING)))

            viewModel.uiState.test {
                assertEquals(HomeUiState.Loading, awaitItem())
                assertEquals(HomeUiState.Greeting(TimeOfDay.EVENING), awaitItem())
            }
        }

    @Test
    fun `state becomes error when the repository fails`() =
        runTest {
            val viewModel = HomeViewModel(FakeGreetingRepository(Result.failure(IOException("boom"))))

            viewModel.uiState.test {
                assertEquals(HomeUiState.Loading, awaitItem())
                assertEquals(HomeUiState.Error, awaitItem())
            }
        }

    @Test
    fun `refresh recovers from error once the repository succeeds again`() =
        runTest {
            val repository = FakeGreetingRepository(Result.failure(IOException("boom")))
            val viewModel = HomeViewModel(repository)

            viewModel.uiState.test {
                assertEquals(HomeUiState.Loading, awaitItem())
                assertEquals(HomeUiState.Error, awaitItem())

                repository.result = Result.success(TimeOfDay.AFTERNOON)
                viewModel.refresh()

                assertEquals(HomeUiState.Loading, awaitItem())
                assertEquals(HomeUiState.Greeting(TimeOfDay.AFTERNOON), awaitItem())
            }
        }

    private class FakeGreetingRepository(
        var result: Result<TimeOfDay>,
    ) : GreetingRepository {
        override suspend fun currentTimeOfDay(): TimeOfDay = result.getOrThrow()
    }
}
