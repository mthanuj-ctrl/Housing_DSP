# ==========================================================================
# Real-Time Housing Price Prediction and Neighborhood Affordability Clustering
# R Shiny Telemetry Engine
# Deploy target: shinyapps.io (free tier: 5 apps, 25 active hours/month)
# ==========================================================================

library(shiny)
library(dplyr)
library(ggplot2)
library(caret)
library(cluster)

# ---------------------------------------------------------------------------
# 1. Obtain: Data Ingestion Layer
# ---------------------------------------------------------------------------
# In production, replace the synthetic seed data below with:
#   - rvest scraping from MagicBricks / 99acres / NoBroker public pages
#   - Kaggle Indian housing datasets (CC0 / public domain)
#   - RBI House Price Index (https://data.rbi.org.in/DBIE/)
#
# The synthetic data mirrors the schema of the Kaggle MagicBricks dataset:
#   city_name, floors, bathrooms, carpet_area, price, price_per_sq_ft
# ---------------------------------------------------------------------------

set.seed(42)

generate_seed_data <- function(n = 500) {
  cities <- c("Bengaluru", "Hyderabad", "Mumbai", "Delhi", "Pune",
              "Chennai", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow")
  
  localities <- c(
    "Koramangala", "Whitefield", "Indiranagar", "HSR Layout",
    "Gachibowli", "Hitech City", "Andheri", "Thane",
    "Baner", "Hinjewadi", "Velachery", "Salt Lake"
  )
  
  data.frame(
    city_name      = sample(cities, n, replace = TRUE),
    locality       = sample(localities, n, replace = TRUE),
    floors         = sample(1:20, n, replace = TRUE),
    bathrooms      = sample(1:4, n, replace = TRUE),
    carpet_area    = round(runif(n, 400, 2500)),
    bhk            = sample(c("1BHK", "2BHK", "3BHK", "4BHK"), n, replace = TRUE),
    price_per_sq_ft = round(runif(n, 4000, 28000)),
    stringsAsFactors = FALSE
  ) %>%
    mutate(
      price = carpet_area * price_per_sq_ft,
      # Simulate a 6% annual appreciation baseline
      appreciation_rate = round(runif(n, 0.03, 0.12), 4)
    )
}

# ---------------------------------------------------------------------------
# 2. Scrub: Cleaning and Feature Engineering
# ---------------------------------------------------------------------------
scrub_data <- function(df) {
  df %>%
    filter(!is.na(price_per_sq_ft), price_per_sq_ft > 0) %>%
    mutate(
      bhk_num = as.numeric(gsub("BHK", "", bhk)),
      log_price = log(price),
      price_band = cut(
        price_per_sq_ft,
        breaks = c(0, 8000, 14000, Inf),
        labels = c("Budget", "Mid-Tier", "Luxury")
      )
    )
}

# ---------------------------------------------------------------------------
# 3. Explore: Summary and Visualisation Helpers
# ---------------------------------------------------------------------------
summarise_locality <- function(df, locality_name) {
  df %>%
    filter(locality == locality_name) %>%
    summarise(
      avg_price_per_sqft = mean(price_per_sq_ft, na.rm = TRUE),
      median_price       = median(price, na.rm = TRUE),
      avg_area           = mean(carpet_area, na.rm = TRUE),
      avg_appreciation   = mean(appreciation_rate, na.rm = TRUE),
      count              = n()
    )
}

# ---------------------------------------------------------------------------
# 4. Model: Multiple Linear Regression and Decision Tree
# ---------------------------------------------------------------------------
train_models <- function(df) {
  # Prepare modelling frame
  model_df <- df %>%
    select(price, carpet_area, floors, bathrooms, bhk_num, price_per_sq_ft) %>%
    na.omit()
  
  # --- Multiple Linear Regression ---
  lm_fit <- lm(price ~ carpet_area + floors + bathrooms + bhk_num,
               data = model_df)
  
  # --- Decision Tree (rpart via caret) ---
  dt_fit <- train(
    price ~ carpet_area + floors + bathrooms + bhk_num,
    data = model_df,
    method = "rpart",
    trControl = trainControl(method = "cv", number = 5),
    tuneLength = 5
  )
  
  list(lm = lm_fit, dt = dt_fit, data = model_df)
}

# ---------------------------------------------------------------------------
# 5. K-Means Clustering for Affordability Tiers
# ---------------------------------------------------------------------------
cluster_localities <- function(df, k = 3) {
  cluster_input <- df %>%
    group_by(locality) %>%
    summarise(
      avg_price_per_sqft = mean(price_per_sq_ft, na.rm = TRUE),
      avg_area           = mean(carpet_area, na.rm = TRUE),
      .groups = "drop"
    )
  
  scaled <- scale(cluster_input[, c("avg_price_per_sqft", "avg_area")])
  
  set.seed(42)
  km <- kmeans(scaled, centers = k, nstart = 25)
  
  cluster_input$cluster <- km$cluster
  
  # Label clusters by affordability (lowest centroid = Budget)
  centroids <- km$centers[, "avg_price_per_sqft"]
  order_idx <- order(centroids)
  labels <- c("Budget", "Mid-Tier", "Luxury")
  cluster_input$tier <- labels[order(match(cluster_input$cluster, order_idx))]
  
  cluster_input
}

# ---------------------------------------------------------------------------
# 6. Interpret: Forecast Function
# ---------------------------------------------------------------------------
forecast_price <- function(current_price, annual_rate) {
  horizons <- c("6 Months" = 0.5, "2 Years" = 2.0, "5 Years" = 5.0)
  data.frame(
    horizon = names(horizons),
    years   = as.numeric(horizons),
    projected_price = sapply(horizons, function(y) {
      current_price * ((1 + annual_rate) ^ y)
    }),
    row.names = NULL
  )
}

# ---------------------------------------------------------------------------
# 7. Shiny UI
# ---------------------------------------------------------------------------
ui <- fluidPage(
  titlePanel("Housing Price Telemetry Engine"),
  
  sidebarLayout(
    sidebarPanel(
      selectInput("locality", "Select Locality:",
                  choices = c("Koramangala", "Whitefield", "Indiranagar",
                              "HSR Layout", "Gachibowli", "Hitech City",
                              "Andheri", "Thane", "Baner", "Hinjewadi",
                              "Velachery", "Salt Lake")),
      numericInput("current_price", "Current Price per Sq.Ft. (INR):",
                   value = 9000, min = 1000, max = 50000),
      numericInput("annual_rate", "Annual Appreciation Rate (decimal):",
                   value = 0.06, min = 0.01, max = 0.25, step = 0.01),
      actionButton("refresh", "Refresh Analysis", class = "btn-primary"),
      hr(),
      h4("Model Summary"),
      verbatimTextOutput("model_summary")
    ),
    
    mainPanel(
      tabsetPanel(
        tabPanel("Metrics",
                 h3("Locality Metrics"),
                 tableOutput("metrics_table")),
        tabPanel("Forecast",
                 h3("Predictive Horizon Engine"),
                 plotOutput("forecast_plot"),
                 tableOutput("forecast_table")),
        tabPanel("Clusters",
                 h3("K-Means Affordability Clusters"),
                 plotOutput("cluster_plot")),
        tabPanel("Data",
                 h3("Cleaned Dataset"),
                 tableOutput("data_table"))
      )
    )
  )
)

# ---------------------------------------------------------------------------
# 8. Shiny Server
# ---------------------------------------------------------------------------
server <- function(input, output, session) {
  
  # Reactive: load and scrub data
  raw_data <- reactive({
    generate_seed_data(500)
  })
  
  cleaned <- reactive({
    scrub_data(raw_data())
  })
  
  # Reactive: train models (cached until data changes)
  models <- reactive({
    train_models(cleaned())
  })
  
  # Reactive: cluster localities
  clusters <- reactive({
    cluster_localities(cleaned(), k = 3)
  })
  
  # Metrics table
  output$metrics_table <- renderTable({
    summarise_locality(cleaned(), input$locality)
  })
  
  # Model summary
  output$model_summary <- renderPrint({
    summary(models()$lm)
  })
  
  # Forecast
  output$forecast_table <- renderTable({
    forecast_price(input$current_price, input$annual_rate)
  })
  
  output$forecast_plot <- renderPlot({
    fc <- forecast_price(input$current_price, input$annual_rate)
    ggplot(fc, aes(x = horizon, y = projected_price)) +
      geom_col(fill = "#2a7f7f", width = 0.5) +
      geom_text(aes(label = paste0("INR ", round(projected_price))),
                vjust = -0.5, size = 3.5, colour = "#2c2824") +
      labs(
        title = paste("Price Forecast for", input$locality),
        x = "Horizon",
        y = "Projected Price per Sq.Ft. (INR)"
      ) +
      theme_minimal(base_size = 13) +
      theme(
        plot.background = element_rect(fill = "#faf8f3", colour = NA),
        panel.background = element_rect(fill = "#faf8f3", colour = NA),
        axis.text = element_text(colour = "#5c554c"),
        axis.title = element_text(colour = "#2c2824"),
        plot.title = element_text(colour = "#2c2824", face = "bold")
      )
  })
  
  # Cluster plot
  output$cluster_plot <- renderPlot({
    cl <- clusters()
    ggplot(cl, aes(x = avg_area, y = avg_price_per_sqft, colour = tier)) +
      geom_point(size = 4) +
      geom_text(aes(label = locality), vjust = -1, size = 3, colour = "#2c2824") +
      scale_colour_manual(values = c(
        "Budget"   = "#3a7d44",
        "Mid-Tier" = "#b8860b",
        "Luxury"   = "#8b3a3a"
      )) +
      labs(
        title = "K-Means Affordability Clustering of Localities",
        x = "Average Carpet Area (sq.ft.)",
        y = "Average Price per Sq.Ft. (INR)",
        colour = "Tier"
      ) +
      theme_minimal(base_size = 13) +
      theme(
        plot.background = element_rect(fill = "#faf8f3", colour = NA),
        panel.background = element_rect(fill = "#faf8f3", colour = NA),
        legend.background = element_rect(fill = "#faf8f3", colour = NA)
      )
  })
  
  # Data table
  output$data_table <- renderTable({
    head(cleaned(), 50)
  })
}

# ---------------------------------------------------------------------------
# 9. Run Application
# ---------------------------------------------------------------------------
shinyApp(ui = ui, server = server)